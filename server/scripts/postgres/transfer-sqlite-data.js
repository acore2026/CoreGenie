const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Client } = require("pg");

const INTERNAL_TABLES = new Set(["_prisma_migrations", "sqlite_sequence"]);
const BATCH_SIZE = 250;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function parseArgs(argv) {
  return {
    execute: argv.includes("--execute"),
  };
}

function sqliteTables(database) {
  return database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    .all()
    .map(({ name }) => name)
    .filter((name) => !INTERNAL_TABLES.has(name));
}

async function postgresTables(client) {
  const result = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  return result.rows
    .map(({ table_name: name }) => name)
    .filter((name) => !INTERNAL_TABLES.has(name));
}

async function postgresColumns(client, table) {
  const result = await client.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return result.rows;
}

async function orderedTables(client, tables) {
  const tableSet = new Set(tables);
  const dependencies = new Map(tables.map((table) => [table, new Set()]));
  const result = await client.query(
    `SELECT child.relname AS child_table, parent.relname AS parent_table
       FROM pg_constraint constraint_info
       JOIN pg_class child ON child.oid = constraint_info.conrelid
       JOIN pg_class parent ON parent.oid = constraint_info.confrelid
       JOIN pg_namespace namespace_info ON namespace_info.oid = child.relnamespace
      WHERE constraint_info.contype = 'f'
        AND namespace_info.nspname = current_schema()`
  );

  for (const row of result.rows) {
    if (
      row.child_table !== row.parent_table &&
      tableSet.has(row.child_table) &&
      tableSet.has(row.parent_table)
    ) {
      dependencies.get(row.child_table).add(row.parent_table);
    }
  }

  const ordered = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining]
      .filter((table) =>
        [...dependencies.get(table)].every((parent) => !remaining.has(parent))
      )
      .sort();
    if (!ready.length) {
      throw new Error(
        `PostgreSQL 外键存在循环，无法确定导入顺序：${[...remaining].join(", ")}`
      );
    }
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

function normalizeValue(value, dataType, stats = null) {
  if (value === null || value === undefined) return null;
  if (dataType === "boolean") return Boolean(value);
  if (typeof value === "string" && value.includes("\0")) {
    const sanitized = value.replaceAll("\0", "");
    if (stats) stats.nulBytesRemoved += value.length - sanitized.length;
    value = sanitized;
  }
  if (
    [
      "date",
      "timestamp with time zone",
      "timestamp without time zone",
    ].includes(dataType)
  ) {
    const numericValue =
      typeof value === "number" || /^-?\d{10,13}$/.test(String(value))
        ? Number(value)
        : null;
    if (numericValue !== null) {
      const milliseconds =
        Math.abs(numericValue) < 100_000_000_000
          ? numericValue * 1_000
          : numericValue;
      return new Date(milliseconds);
    }
  }
  return value;
}

async function assertEmptyTarget(client, tables) {
  for (const table of tables) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)}`
    );
    if (Number(result.rows[0].count) > 0) {
      throw new Error(`目标表 ${table} 不是空表。为避免覆盖数据，迁移已停止。`);
    }
  }
}

async function insertTable({ sqlite, client, table, targetColumns, stats }) {
  const sourceColumns = sqlite
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all()
    .map(({ name }) => name);
  const targetColumnMap = new Map(
    targetColumns.map(({ column_name, data_type }) => [column_name, data_type])
  );
  const missingTargetColumns = sourceColumns.filter(
    (column) => !targetColumnMap.has(column)
  );
  if (missingTargetColumns.length) {
    throw new Error(
      `目标表 ${table} 缺少字段：${missingTargetColumns.join(", ")}`
    );
  }

  const columns = sourceColumns.filter((column) => targetColumnMap.has(column));
  const rows = sqlite
    .prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
    .iterate();
  let batch = [];
  let copied = 0;

  async function flush() {
    if (!batch.length) return;
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(
          normalizeValue(row[column], targetColumnMap.get(column), stats)
        );
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `INSERT INTO ${quoteIdentifier(table)} (${columns
        .map(quoteIdentifier)
        .join(", ")}) VALUES ${tuples.join(", ")}`,
      values
    );
    copied += batch.length;
    batch = [];
  }

  for (const row of rows) {
    batch.push(row);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return copied;
}

async function resetSequences(client, tables) {
  for (const table of tables) {
    const result = await client.query(
      "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
      [table]
    );
    const sequenceName = result.rows[0]?.sequence_name;
    if (!sequenceName) continue;
    await client.query(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(
        table
      )}), 1), (SELECT COUNT(*) > 0 FROM ${quoteIdentifier(table)}))`,
      [sequenceName]
    );
  }
}

async function verifyTargetCounts(client, plan) {
  for (const item of plan) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(item.table)}`
    );
    const targetRows = Number(result.rows[0].count);
    if (targetRows !== item.rows) {
      throw new Error(
        `${item.table} 行数核对失败：源库 ${item.rows}，目标库 ${targetRows}`
      );
    }
  }
}

async function main() {
  const { execute } = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(
    process.env.SQLITE_DATABASE_PATH ||
      path.resolve(__dirname, "../../storage/anythingllm.db")
  );
  const databaseUrl = process.env.DATABASE_URL;

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`找不到 SQLite 数据库：${sqlitePath}`);
  }
  if (!databaseUrl) {
    throw new Error("请设置 PostgreSQL 的 DATABASE_URL。");
  }

  const sqlite = new Database(sqlitePath, {
    readonly: true,
    fileMustExist: true,
  });
  const integrity = sqlite.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(`SQLite 完整性检查失败：${integrity}`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const sourceTables = sqliteTables(sqlite);
    const targetTables = await postgresTables(client);
    const missingTables = sourceTables.filter(
      (table) => !targetTables.includes(table)
    );
    if (missingTables.length) {
      throw new Error(`PostgreSQL 缺少数据表：${missingTables.join(", ")}`);
    }

    await assertEmptyTarget(client, targetTables);
    const tables = await orderedTables(client, sourceTables);
    const stats = { nulBytesRemoved: 0 };
    const plan = tables.map((table) => ({
      table,
      rows: sqlite
        .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
        .get().count,
    }));
    console.log(`SQLite 完整性检查通过，共 ${plan.length} 张业务表。`);
    for (const item of plan) console.log(`${item.table}: ${item.rows} 行`);

    if (!execute) {
      console.log(
        "当前为检查模式。确认应用已停止写入后，添加 --execute 执行迁移。"
      );
      return;
    }

    await client.query("BEGIN");
    try {
      for (const item of plan) {
        const targetColumns = await postgresColumns(client, item.table);
        const copied = await insertTable({
          sqlite,
          client,
          table: item.table,
          targetColumns,
          stats,
        });
        if (copied !== item.rows) {
          throw new Error(
            `${item.table} 复制行数不一致：源库 ${item.rows}，目标库 ${copied}`
          );
        }
      }
      await resetSequences(client, tables);
      await verifyTargetCounts(client, plan);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    if (stats.nulBytesRemoved) {
      console.log(
        `已从文本字段移除 ${stats.nulBytesRemoved} 个 PostgreSQL 不支持的 NUL 字节。`
      );
    }
    console.log("业务数据迁移完成。请在切换流量前运行应用测试并再次核对数据。");
  } finally {
    sqlite.close();
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`迁移失败：${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  normalizeValue,
  orderedTables,
  parseArgs,
  quoteIdentifier,
};
