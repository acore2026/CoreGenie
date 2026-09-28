// 把 export-global-vectors.js 导出的 JSON 导入 Qdrant，用于目标服务器 CPU 不支持
// AVX、无法运行 LanceDB 的场景。集合格式与 server/utils/vectorDbProviders/qdrant
// 的 addDocumentToNamespace 保持一致：point id 用向量 id，payload 放其余字段。
//
// 在目标机的应用容器内运行（容器里有 @qdrant/js-client-rest）：
//   docker cp global-vectors.json <容器>:/tmp/global-vectors.json
//   docker exec -w /app/server -e QDRANT_ENDPOINT=http://anythingllm-qdrant:6333 \
//     <容器> node scripts/offline/import-global-vectors-qdrant.js \
//     --input /tmp/global-vectors.json
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
  };
  return {
    input: value("--input"),
    endpoint:
      value("--endpoint") ||
      process.env.QDRANT_ENDPOINT ||
      "http://localhost:6333",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) throw new Error("需要 --input <文件>。");
  const { QdrantClient } = require("@qdrant/js-client-rest");
  const client = new QdrantClient({ url: args.endpoint });
  const data = JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8"));

  for (const [namespace, info] of Object.entries(data)) {
    const rows = info.rows || [];
    console.log(`${namespace}: ${rows.length} 行`);
    if (!rows.length) continue;
    const dimension = rows[0].vector.length;
    const existing = await client.getCollections();
    if (!existing.collections.some((c) => c.name === namespace)) {
      await client.createCollection(namespace, {
        vectors: { size: dimension, distance: "Cosine" },
      });
      console.log(`  已创建集合（维度 ${dimension}，Cosine）`);
    }
    for (let i = 0; i < rows.length; i += 100) {
      const points = rows.slice(i, i + 100).map((row) => {
        const { id, vector, ...payload } = row;
        return { id, vector, payload };
      });
      const result = await client.upsert(namespace, { wait: true, points });
      if (result.status !== "completed")
        throw new Error(`写入失败：${JSON.stringify(result)}`);
    }
    const collection = await client.getCollection(namespace);
    console.log(`  导入完成，points_count=${collection.points_count}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
