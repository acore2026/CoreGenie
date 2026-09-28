#!/usr/bin/env node

/**
 * Export and import the installation-wide data used by an offline deployment.
 *
 * Workspace rows are deliberately excluded. The package contains the two
 * global LanceDB namespaces, so the target does not need to re-embed global
 * knowledge or global Agent memory.
 */

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const dotenv = require("dotenv");
const environmentFile =
  process.env.NODE_ENV === "development" ? ".env.development" : ".env";
dotenv.config({ path: path.resolve(__dirname, "../../", environmentFile) });
// LanceDB loads a native extension that crashes on CPUs without AVX. Load it
// lazily so import-only runs never touch it.
let lancedb = null;
function getLanceDb() {
  if (!lancedb) lancedb = require("@lancedb/lancedb");
  return lancedb;
}
const prisma = require("../../utils/prisma");

const FORMAT = "anythingllm-global-data";
const FORMAT_VERSION = 1;
const GLOBAL_KNOWLEDGE_NAMESPACE = "anythingllm-global-knowledge";
const GLOBAL_MEMORY_NAMESPACE = "anythingllm-global-rag-memory";
const GLOBAL_NAMESPACES = [GLOBAL_KNOWLEDGE_NAMESPACE, GLOBAL_MEMORY_NAMESPACE];

// These tables are installation-wide or contain an explicitly global scope.
// Workspace tables are intentionally absent from this list.
const TABLE_SPECS = [
  { name: "users", delegate: "users" },
  { name: "recovery_codes", delegate: "recovery_codes" },
  { name: "system_settings", delegate: "system_settings" },
  { name: "api_keys", delegate: "api_keys" },
  { name: "global_reference_entries", delegate: "global_reference_entries" },
  { name: "agent_feedback_reasons", delegate: "agent_feedback_reasons" },
  { name: "model_capabilities", delegate: "model_capabilities" },
  { name: "predefined_agent_skills", delegate: "predefined_agent_skills" },
  { name: "predefined_quick_tasks", delegate: "predefined_quick_tasks" },
  { name: "agent_skill_revisions", delegate: "agent_skill_revisions" },
  { name: "predefined_agents", delegate: "predefined_agents" },
  { name: "model_routers", delegate: "model_routers" },
  { name: "model_router_rules", delegate: "model_router_rules" },
  { name: "system_prompt_variables", delegate: "system_prompt_variables" },
  {
    name: "slash_command_presets",
    delegate: "slash_command_presets",
    where: { uid: 0 },
  },
  {
    name: "external_communication_connectors",
    delegate: "external_communication_connectors",
  },
  {
    name: "scheduled_jobs",
    delegate: "scheduled_jobs",
    where: { workspace_id: null },
  },
  {
    name: "memories",
    delegate: "memories",
    where: { scope: "global", workspaceId: null },
  },
  { name: "event_logs", delegate: "event_logs" },
  {
    name: "browser_extension_api_keys",
    delegate: "browser_extension_api_keys",
  },
  {
    name: "desktop_mobile_devices",
    delegate: "desktop_mobile_devices",
  },
  {
    name: "invites",
    delegate: "invites",
    where: { workspaceIds: null },
  },
  { name: "global_documents", delegate: "global_documents" },
];

// Tables whose "id" column is an integer serial. Tables with a String or
// UUID primary key must not run through setval on the "id" sequence.
const ID_TABLES = new Set(
  [...TABLE_SPECS, { name: "scheduled_job_runs" }, { name: "document_vectors" }]
    .filter(
      (spec) =>
        spec.name !== "global_reference_entries" &&
        spec.name !== "agent_skill_revisions"
    )
    .map((spec) => spec.name)
);

// Prisma field names can differ from PostgreSQL column names when the schema
// uses @map. Keep the JSON format in Prisma's field shape and translate only
// at the raw SQL insertion boundary.
const DATABASE_COLUMN_MAP = {
  memories: {
    userId: "user_id",
    workspaceId: "workspace_id",
    lastUsedAt: "last_used_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
};

function storageRoot() {
  return path.resolve(
    process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage")
  );
}

function defaultDatabaseProvider() {
  if (process.env.DATABASE_PROVIDER)
    return String(process.env.DATABASE_PROVIDER).toLowerCase();
  if (/^postgres(?:ql)?:/i.test(String(process.env.DATABASE_URL || "")))
    return "postgresql";
  return "sqlite";
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function safeRelativePath(value, label) {
  const raw = String(value || "").replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || path.posix.isAbsolute(raw))
    throw new Error(`${label} 必须是相对路径。`);
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../"))
    throw new Error(`${label} 超出允许目录：${value}`);
  return normalized;
}

function resolveWithin(root, relative, label) {
  const safe = safeRelativePath(relative, label);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, safe);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error(`${label} 超出允许目录：${relative}`);
  return resolved;
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfPresent(source, destination) {
  if (!(await exists(source))) return false;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.cp(source, destination, { recursive: true, force: true });
  return true;
}

async function copyRootFiles(sourceRoot, destinationRoot) {
  if (!(await exists(sourceRoot))) return [];
  const copied = [];
  for (const entry of await fsp.readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    await fsp.mkdir(destinationRoot, { recursive: true });
    await fsp.copyFile(source, destination);
    copied.push(path.relative(destinationRoot, destination));
  }
  return copied;
}

async function readRows(spec, warnings = []) {
  const delegate = prisma[spec.delegate];
  if (!delegate || typeof delegate.findMany !== "function") return [];
  try {
    return await delegate.findMany({
      ...(spec.where ? { where: spec.where } : {}),
      orderBy:
        spec.name === "global_documents" ? { createdAt: "asc" } : undefined,
    });
  } catch (error) {
    // Older installations may predate a newly introduced global table. Treat
    // that table as empty and let the target migration create it.
    if (error?.code === "P2021" || error?.code === "P2022") {
      warnings.push(
        `跳过 ${spec.name}：源数据库缺少对应表或列（${error.code}）。`
      );
      return [];
    }
    throw error;
  }
}

async function readGlobalJobsRuns(jobs, warnings = []) {
  const jobIds = jobs.map((job) => job.id).filter(Number.isInteger);
  if (!jobIds.length || !prisma.scheduled_job_runs) return [];
  try {
    return await prisma.scheduled_job_runs.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: { id: "asc" },
    });
  } catch (error) {
    if (error?.code === "P2021" || error?.code === "P2022") {
      warnings.push(
        `跳过 scheduled_job_runs：源数据库缺少对应表或列（${error.code}）。`
      );
      return [];
    }
    throw error;
  }
}

async function copyGlobalDocumentSources(
  documents,
  sourceRoot,
  packageStorage
) {
  const copied = [];
  const warnings = [];
  const documentsRoot = path.join(sourceRoot, "documents");
  const globalKnowledgeRoot = path.join(sourceRoot, "global-knowledge");
  for (const document of documents) {
    let metadata = {};
    try {
      metadata = JSON.parse(document.metadata || "{}");
    } catch {
      warnings.push(
        `global_documents ${document.docId} 的 metadata 不是有效 JSON。`
      );
    }

    const sourceName = metadata.sourceFile?.storageName;
    if (sourceName) {
      const safeName = safeRelativePath(sourceName, "global knowledge source");
      const source = resolveWithin(
        globalKnowledgeRoot,
        safeName,
        "global knowledge source"
      );
      const destination = resolveWithin(
        path.join(packageStorage, "global-knowledge"),
        safeName,
        "global knowledge package path"
      );
      if (!(await exists(source))) {
        warnings.push(`缺少全局知识源文件：${sourceName}`);
      } else {
        await copyIfPresent(source, destination);
        copied.push(path.relative(packageStorage, destination));
      }
    }

    const docpath = safeRelativePath(
      document.docpath,
      "global document docpath"
    );
    const parsedDocument = resolveWithin(
      documentsRoot,
      docpath,
      "global document docpath"
    );
    const destination = resolveWithin(
      path.join(packageStorage, "documents"),
      docpath,
      "global document package path"
    );
    if (!(await exists(parsedDocument))) {
      warnings.push(`缺少全局文档解析文件：${document.docpath}`);
    } else {
      await copyIfPresent(parsedDocument, destination);
      copied.push(path.relative(packageStorage, destination));
    }
  }
  return { copied, warnings };
}

async function copyGlobalStorage(sourceRoot, packageStorage) {
  const copied = [];
  const optionalDirectories = [
    "agent-skills/global",
    "plugins",
    "comkey",
    "models",
  ];
  for (const relative of optionalDirectories) {
    const source = path.join(sourceRoot, relative);
    const destination = path.join(packageStorage, relative);
    if (await copyIfPresent(source, destination)) copied.push(relative);
  }

  const assetsRoot = path.join(sourceRoot, "assets");
  const packageAssetsRoot = path.join(packageStorage, "assets");
  const rootFiles = await copyRootFiles(assetsRoot, packageAssetsRoot);
  if (rootFiles.length) copied.push("assets");
  if (
    await copyIfPresent(
      path.join(assetsRoot, "agent-icons"),
      path.join(packageAssetsRoot, "agent-icons")
    )
  )
    copied.push("assets/agent-icons");
  return copied;
}

async function exportLanceDb(sourceRoot, packageStorage) {
  const provider = String(process.env.VECTOR_DB || "lancedb").toLowerCase();
  if (provider !== "lancedb")
    throw new Error(
      `离线数据包当前只支持 LanceDB。当前 VECTOR_DB=${provider}，请先切换到 LanceDB 或单独导出外部向量库。`
    );
  const sourcePath = path.join(sourceRoot, "lancedb");
  const destinationPath = path.join(packageStorage, "lancedb");
  if (!(await exists(sourcePath)))
    return { provider: "lancedb", namespaces: {}, warnings: [], vectorIds: [] };

  const lancedb = getLanceDb();
  const source = await lancedb.connect(sourcePath);
  const destination = await lancedb.connect(destinationPath);
  const sourceTables = await source.tableNames();
  const namespaces = {};
  const warnings = [];
  const vectorIds = [];
  for (const namespace of GLOBAL_NAMESPACES) {
    if (!sourceTables.includes(namespace)) {
      namespaces[namespace] = { present: false, rows: 0 };
      continue;
    }
    const table = await source.openTable(namespace);
    const arrow = await table.toArrow();
    await destination.createTable(namespace, arrow);
    namespaces[namespace] = { present: true, rows: await table.countRows() };
    for (const row of await table.query().toArray()) {
      if (row?.id) vectorIds.push(String(row.id));
    }
  }
  if (typeof source.close === "function") source.close();
  if (typeof destination.close === "function") destination.close();
  if (sourceTables.some((name) => !GLOBAL_NAMESPACES.includes(name)))
    warnings.push("LanceDB 中的 Workspace 命名空间已排除。 ");
  return { provider: "lancedb", namespaces, warnings, vectorIds };
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function listFiles(root, prefix = "") {
  if (!(await exists(root))) return [];
  const output = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory())
      output.push(...(await listFiles(absolute, relative)));
    else if (entry.isFile()) output.push({ relative, absolute });
  }
  return output;
}

async function exportGlobalData(outputRoot) {
  const output = path.resolve(outputRoot);
  const packageStorage = path.join(output, "storage");
  await fsp.rm(output, { recursive: true, force: true });
  await fsp.mkdir(packageStorage, { recursive: true });

  const warnings = [];
  const tableData = {};
  for (const spec of TABLE_SPECS)
    tableData[spec.name] = await readRows(spec, warnings);
  tableData.scheduled_job_runs = await readGlobalJobsRuns(
    tableData.scheduled_jobs,
    warnings
  );

  const globalDocIds = new Set(
    tableData.global_documents.map((document) => document.docId)
  );
  const vectorData = await readRows(
    {
      name: "document_vectors",
      delegate: "document_vectors",
    },
    warnings
  );

  const lance = await exportLanceDb(storageRoot(), packageStorage);
  // Keep mappings only for the copied global namespaces. Workspace mappings
  // are deliberately dropped even when they share the same source database.
  const globalVectorIds = new Set(lance.vectorIds);
  tableData.document_vectors = vectorData.filter(
    (record) =>
      globalDocIds.has(record.docId) ||
      globalVectorIds.has(String(record.vectorId))
  );

  const sourceFiles = await copyGlobalDocumentSources(
    tableData.global_documents,
    storageRoot(),
    packageStorage
  );
  const copiedStorage = await copyGlobalStorage(storageRoot(), packageStorage);
  warnings.push(...sourceFiles.warnings, ...lance.warnings);
  if (warnings.length) {
    await writeJson(path.join(output, "warnings.json"), warnings);
  }

  for (const [name, rows] of Object.entries(tableData))
    await writeJson(path.join(output, "tables", `${name}.json`), rows);

  const files = await listFiles(output);
  const checksums = {};
  for (const file of files) {
    if (file.relative === "manifest.json") continue;
    checksums[file.relative.split(path.sep).join("/")] = await sha256File(
      file.absolute
    );
  }
  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDatabaseProvider: defaultDatabaseProvider(),
    vectorProvider: lance.provider,
    tables: Object.fromEntries(
      Object.entries(tableData).map(([name, rows]) => [name, rows.length])
    ),
    vectors: lance.namespaces,
    copiedStorage,
    copiedFiles: sourceFiles.copied,
    warnings,
    checksums,
  };
  await writeJson(path.join(output, "manifest.json"), manifest);
  return manifest;
}

function readManifest(packageRoot) {
  const manifestPath = path.join(path.resolve(packageRoot), "manifest.json");
  if (!fs.existsSync(manifestPath))
    throw new Error(`找不到离线数据包 manifest：${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== FORMAT || manifest.version !== FORMAT_VERSION)
    throw new Error("离线数据包版本不受当前程序支持。");
  return manifest;
}

async function verifyChecksums(packageRoot, manifest) {
  for (const [relative, expected] of Object.entries(manifest.checksums || {})) {
    const filePath = resolveWithin(packageRoot, relative, "package file");
    if (!(await exists(filePath)))
      throw new Error(`离线数据包缺少文件：${relative}`);
    const actual = await sha256File(filePath);
    if (actual !== expected) throw new Error(`离线数据包校验失败：${relative}`);
  }
}

async function ensureTargetEmpty(tableNames) {
  for (const table of tableNames) {
    const result = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)}`
    );
    const count = Number(result?.[0]?.count || 0);
    if (count > 0)
      throw new Error(
        `目标表 ${table} 已有 ${count} 条记录。请在空数据库上导入，或显式使用 --allow-existing。`
      );
  }
}

function primaryKeyFor(table) {
  return table === "global_reference_entries" ? ["key"] : ["id"];
}

// JSON round-trips turn Prisma DateTime fields into ISO strings. PostgreSQL
// rejects text parameters for timestamp columns, so convert them back to Date
// using the Prisma DMMF field types.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function dateTimeFieldsFor(table) {
  const model = prisma._runtimeDataModel?.models?.[table];
  if (!model) return new Set();
  return new Set(
    model.fields
      .filter((field) => field.type === "DateTime")
      .map((field) => field.name)
  );
}

function reviveRowValues(table, row) {
  const dateFields = dateTimeFieldsFor(table);
  if (!dateFields.size) return row;
  const revived = { ...row };
  for (const field of dateFields) {
    const value = revived[field];
    if (typeof value === "string" && ISO_DATE.test(value))
      revived[field] = new Date(value);
  }
  return revived;
}

async function insertRows(client, table, rows, { allowExisting = false } = {}) {
  if (!rows.length) return;
  const primaryKey = primaryKeyFor(table);
  const columnMap = DATABASE_COLUMN_MAP[table] || {};
  for (const inputRow of rows) {
    const row = reviveRowValues(table, inputRow);
    const columns = Object.keys(row);
    if (!columns.length) continue;
    const values = columns.map((column) => row[column]);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const databaseColumns = columns.map(
      (column) => columnMap[column] || column
    );
    const quotedColumns = databaseColumns.map(quoteIdentifier).join(", ");
    const conflict = primaryKey
      .map((column) => quoteIdentifier(columnMap[column] || column))
      .join(", ");
    const updates = columns
      .filter((column) => !primaryKey.includes(column))
      .map(
        (column) =>
          `${quoteIdentifier(columnMap[column] || column)} = EXCLUDED.${quoteIdentifier(columnMap[column] || column)}`
      )
      .join(", ");
    const conflictSql = allowExisting
      ? updates
        ? ` ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`
        : ` ON CONFLICT (${conflict}) DO NOTHING`
      : "";
    await client.$executeRawUnsafe(
      `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders})${conflictSql}`,
      ...values
    );
  }
}

async function resetSequences(client, tableNames) {
  for (const table of tableNames) {
    if (!ID_TABLES.has(table)) continue;
    await client
      .$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX("id")::bigint FROM ${quoteIdentifier(table)}), 1), COALESCE((SELECT COUNT(*) > 0 FROM ${quoteIdentifier(table)}), false))`
      )
      .catch(() => null);
  }
}

async function copyPackageStorage(packageRoot, targetStorage) {
  const source = path.join(packageRoot, "storage");
  if (!(await exists(source))) return;
  await fsp.mkdir(targetStorage, { recursive: true });
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(targetStorage, entry.name);
    await fsp.rm(targetPath, { recursive: true, force: true });
    await fsp.cp(sourcePath, targetPath, { recursive: true, force: true });
  }
}

async function importGlobalData(
  packageRoot,
  { allowExisting = false, targetStorage = storageRoot() } = {}
) {
  if (!["postgres", "postgresql"].includes(defaultDatabaseProvider()))
    throw new Error("离线全局数据导入当前要求目标数据库使用 PostgreSQL。");
  const root = path.resolve(packageRoot);
  const manifest = readManifest(root);
  await verifyChecksums(root, manifest);
  const tableNames = Object.keys(manifest.tables || {}).filter(
    (name) => name !== "scheduled_job_runs"
  );
  if (!allowExisting)
    await ensureTargetEmpty([...tableNames, "scheduled_job_runs"]);

  const ordered = [
    "users",
    "recovery_codes",
    "system_settings",
    "api_keys",
    "global_reference_entries",
    "agent_feedback_reasons",
    "model_capabilities",
    "predefined_agent_skills",
    "predefined_quick_tasks",
    "agent_skill_revisions",
    "predefined_agents",
    "model_routers",
    "model_router_rules",
    "system_prompt_variables",
    "slash_command_presets",
    "external_communication_connectors",
    "scheduled_jobs",
    "scheduled_job_runs",
    "memories",
    "event_logs",
    "browser_extension_api_keys",
    "desktop_mobile_devices",
    "invites",
    "global_documents",
    "document_vectors",
  ];
  await prisma.$transaction(async (client) => {
    for (const table of ordered) {
      const filePath = path.join(root, "tables", `${table}.json`);
      if (!(await exists(filePath))) continue;
      const rows = JSON.parse(await fsp.readFile(filePath, "utf8"));
      await insertRows(client, table, rows, { allowExisting });
    }
    await resetSequences(client, ordered);
  });
  await copyPackageStorage(root, path.resolve(targetStorage));
  const marker = path.join(
    path.resolve(targetStorage),
    ".offline-global-data-imported.json"
  );
  await writeJson(marker, {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: manifest.exportedAt,
    importedAt: new Date().toISOString(),
  });
  return manifest;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const value = (name) => {
    const index = rest.indexOf(name);
    return index === -1 ? null : rest[index + 1];
  };
  return {
    command,
    output: value("--output"),
    packageRoot: value("--package"),
    storageRoot: value("--storage-root"),
    allowExisting: rest.includes("--allow-existing"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "export") {
    if (!args.output) throw new Error("export 需要 --output <目录>。");
    const manifest = await exportGlobalData(args.output);
    console.log(`全局数据包已生成：${path.resolve(args.output)}`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  if (args.command === "import") {
    if (!args.packageRoot) throw new Error("import 需要 --package <目录>。");
    const manifest = await importGlobalData(args.packageRoot, {
      allowExisting: args.allowExisting,
      targetStorage: args.storageRoot || storageRoot(),
    });
    console.log(`全局数据包已导入：${manifest.exportedAt}`);
    return;
  }
  throw new Error(
    "用法：node global-data.js export --output <目录> | node global-data.js import --package <目录> [--storage-root <目录>] [--allow-existing]"
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`离线全局数据操作失败：${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => {});
    });
}

module.exports = {
  FORMAT,
  FORMAT_VERSION,
  GLOBAL_NAMESPACES,
  TABLE_SPECS,
  exportGlobalData,
  importGlobalData,
  insertRows,
  primaryKeyFor,
  resolveWithin,
  reviveRowValues,
  safeRelativePath,
};
