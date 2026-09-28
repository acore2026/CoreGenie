// 把 LanceDB 中的全局向量命名空间导出为 JSON，供无法运行 LanceDB 的目标服务器
// （CPU 不支持 AVX）转换导入 Qdrant 等外部向量库。
//
// 在源站 server 目录运行：
//   node scripts/offline/export-global-vectors.js --output /tmp/global-vectors.json
//
// 输出结构：{ "<命名空间>": { present, rows: [{ id, ...元数据, text, vector }] } }
const fs = require("fs");
const path = require("path");

const GLOBAL_NAMESPACES = [
  "anythingllm-global-knowledge",
  "anythingllm-global-rag-memory",
];

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
  };
  return {
    output: value("--output"),
    source:
      value("--lancedb") ||
      path.join(
        path.resolve(
          process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage")
        ),
        "lancedb"
      ),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) throw new Error("需要 --output <文件>。");
  const lancedb = require("@lancedb/lancedb");
  const db = await lancedb.connect(args.source);
  const tables = await db.tableNames();
  const output = {};
  for (const ns of GLOBAL_NAMESPACES) {
    if (!tables.includes(ns)) {
      output[ns] = { present: false, rows: [] };
      continue;
    }
    const table = await db.openTable(ns);
    const count = await table.countRows();
    // query() 默认只取部分行，必须显式 limit 到全部行数。
    const rows = await table.query().limit(count).toArray();
    if (rows.length !== count)
      throw new Error(`${ns}: 读取到 ${rows.length} / ${count} 行`);
    output[ns] = { present: true, rows };
    console.log(`${ns}: ${rows.length} 行`);
  }
  fs.writeFileSync(
    path.resolve(args.output),
    `${JSON.stringify(output)}\n`,
    "utf8"
  );
  console.log(`已写入 ${path.resolve(args.output)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
