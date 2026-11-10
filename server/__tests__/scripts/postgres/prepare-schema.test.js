const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const {
  postgresSchemaFrom,
  preparePostgresSchema,
} = require("../../../scripts/postgres/prepare-schema");

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

  describe("safe generated schema replacement", () => {
    let directory;
    let sourcePath;
    let outputPath;
    beforeEach(() => {
      directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "postgres-schema-test-")
      );
      sourcePath = path.join(directory, "source.prisma");
      outputPath = path.join(directory, "schema.prisma");
      fs.writeFileSync(
        sourcePath,
        'datasource db {\n  provider = "sqlite"\n}\nmodel users {\n  displayName String?\n}\n'
      );
      fs.writeFileSync(outputPath, "old schema", { mode: 0o444 });
    });
    afterEach(() => {
      jest.restoreAllMocks();
      fs.rmSync(directory, { recursive: true, force: true });
    });

    test("replaces an inherited read-only file instead of writing through it", () => {
      const oldInode = fs.statSync(outputPath).ino;
      expect(preparePostgresSchema({ sourcePath, outputPath })).toBe(
        outputPath
      );
      expect(fs.statSync(outputPath).ino).not.toBe(oldInode);
      expect(fs.readFileSync(outputPath, "utf8")).toContain(
        "displayName String?"
      );
      expect(fs.readFileSync(outputPath, "utf8")).toContain(
        'provider = "postgresql"'
      );
      expect(fs.readdirSync(directory).sort()).toEqual([
        "schema.prisma",
        "source.prisma",
      ]);
    });

    test("preserves the previous file and removes temporary files on failure", () => {
      jest.spyOn(fs, "renameSync").mockImplementation(() => {
        throw new Error("rename denied");
      });
      expect(() => preparePostgresSchema({ sourcePath, outputPath })).toThrow(
        "rename denied"
      );
      expect(fs.readFileSync(outputPath, "utf8")).toBe("old schema");
      expect(fs.readdirSync(directory).sort()).toEqual([
        "schema.prisma",
        "source.prisma",
      ]);
    });

    test("entrypoint stops when PostgreSQL schema generation fails", () => {
      const entrypoint = fs
        .readFileSync(
          path.resolve(__dirname, "../../../../docker/docker-entrypoint.sh"),
          "utf8"
        )
        .replace("cd /app/server/", `cd ${JSON.stringify(directory)}`);
      const marker = path.join(directory, "unexpected-start");
      fs.writeFileSync(
        path.join(directory, "node"),
        '#!/bin/bash\ncase "$1" in\n./scripts/postgres/prepare-schema.js) exit 42;;\n*/collector/index.js) sleep 0.2; exit 0;;\n*) touch "$START_MARKER";;\nesac\n',
        { mode: 0o755 }
      );
      fs.writeFileSync(
        path.join(directory, "npx"),
        '#!/bin/bash\ntouch "$START_MARKER"\n',
        { mode: 0o755 }
      );
      const result = spawnSync("bash", ["-c", entrypoint], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          DATABASE_PROVIDER: "postgresql",
          STORAGE_DIR: directory,
          START_MARKER: marker,
        },
        timeout: 5000,
      });
      expect(result.status).toBe(42);
      expect(fs.existsSync(marker)).toBe(false);
    });
  });
});
