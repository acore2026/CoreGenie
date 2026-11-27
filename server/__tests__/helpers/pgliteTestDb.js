const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");
const { PrismaClient } = require("@prisma/client");

const SCHEMA_PATH = path.resolve(__dirname, "../../prisma/schema.prisma");
const serverRequire = createRequire(
  path.resolve(__dirname, "../../package.json")
);
let cachedSchemaSql = null;

function loadPgliteModules() {
  const { PGlite } = serverRequire("@electric-sql/pglite");
  const { PGLiteSocketServer } = serverRequire("@electric-sql/pglite-socket");
  return { PGlite, PGLiteSocketServer };
}

function getSchemaSql() {
  if (cachedSchemaSql) return cachedSchemaSql;
  cachedSchemaSql = execFileSync(
    process.execPath,
    [
      serverRequire.resolve("prisma/build/index.js"),
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      SCHEMA_PATH,
      "--script",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      },
    }
  );
  return cachedSchemaSql;
}

/**
 * Starts an embedded in-memory PostgreSQL instance via PGlite + socket server,
 * applies the current Prisma PostgreSQL schema, and returns a connected
 * PrismaClient plus helpers for fast per-test truncation and cleanup.
 */
async function createPgliteTestDb({ applySchema = true } = {}) {
  const { PGlite, PGLiteSocketServer } = loadPgliteModules();

  const db = new PGlite();
  await db.waitReady;

  const schemaSql = getSchemaSql();
  if (applySchema) {
    await db.exec(schemaSql);
  }

  const server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
  });
  await server.start();

  const address = server.server?.address();
  const port =
    typeof address === "object" && address ? address.port : server.port;
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1`;

  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });

  async function truncateAll() {
    const result = await db.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const names = result.rows
      .map((row) => `"${String(row.tablename).replace(/"/g, '""')}"`)
      .join(", ");
    if (names) {
      await db.exec(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE;`);
    }
  }

  async function close() {
    await prisma.$disconnect().catch(() => {});
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
  }

  return { prisma, db, url, schemaSql, truncateAll, close };
}

module.exports = { createPgliteTestDb, getSchemaSql, loadPgliteModules };
