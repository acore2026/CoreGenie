const fs = require("fs");
const path = require("path");

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

function preparePostgresSchema() {
  const sqliteSchema = fs.readFileSync(sqliteSchemaPath, "utf8");
  const postgresSchema = postgresSchemaFrom(sqliteSchema);
  fs.mkdirSync(postgresDir, { recursive: true });
  fs.writeFileSync(postgresSchemaPath, postgresSchema);
  return postgresSchemaPath;
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
