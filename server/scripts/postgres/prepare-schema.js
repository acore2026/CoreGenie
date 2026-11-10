const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const serverRoot = path.resolve(__dirname, "../..");
const sqliteSchemaPath = path.join(serverRoot, "prisma", "schema.prisma");
const postgresDir = path.join(serverRoot, "prisma-postgresql");
const postgresSchemaPath = path.join(postgresDir, "schema.prisma");

function postgresSchemaFrom(sqliteSchema) {
  const datasourcePattern = /^datasource db \{[\s\S]*?^\}/m;
  if (!datasourcePattern.test(sqliteSchema)) {
    throw new Error("找不到 Prisma datasource db 配置。");
  }

  return sqliteSchema.replace(
    datasourcePattern,
    [
      "datasource db {",
      '  provider = "postgresql"',
      '  url      = env("DATABASE_URL")',
      "}",
    ].join("\n")
  );
}

function preparePostgresSchema({
  sourcePath = sqliteSchemaPath,
  outputPath = postgresSchemaPath,
} = {}) {
  const sqliteSchema = fs.readFileSync(sourcePath, "utf8");
  const postgresSchema = postgresSchemaFrom(sqliteSchema);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // Images may contain a root-owned generated schema. Replace its directory
  // entry atomically instead of opening that inherited file for writing.
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, postgresSchema, { flag: "wx" });
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return outputPath;
}

if (require.main === module) {
  try {
    const outputPath = preparePostgresSchema();
    console.log(`PostgreSQL Prisma schema 已生成：${outputPath}`);
  } catch (error) {
    console.error(`生成 PostgreSQL Prisma schema 失败：${error.message}`);
    process.exit(1);
  }
}

module.exports = { postgresSchemaFrom, preparePostgresSchema };
