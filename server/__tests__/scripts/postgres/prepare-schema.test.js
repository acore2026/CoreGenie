const fs = require("fs");
const path = require("path");
const { postgresSchemaFrom } = require("../../../scripts/postgres/prepare-schema");

describe("PostgreSQL Prisma schema preparation", () => {
  test("only replaces the active datasource and preserves all models", () => {
    const schemaPath = path.resolve(__dirname, "../../../prisma/schema.prisma");
    const sqliteSchema = fs.readFileSync(schemaPath, "utf8");
    const postgresSchema = postgresSchemaFrom(sqliteSchema);

    expect(postgresSchema).toContain('provider = "postgresql"');
    expect(postgresSchema).toContain('url      = env("DATABASE_URL")');
    expect(postgresSchema).not.toContain('provider = "sqlite"');
    expect(postgresSchema.match(/^model /gm)).toHaveLength(
      sqliteSchema.match(/^model /gm).length
    );
  });

  test("rejects input without an active datasource", () => {
    expect(() => postgresSchemaFrom("model users { id Int @id }")).toThrow(
      "找不到 Prisma datasource db 配置"
    );
  });
});
