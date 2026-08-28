const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

function normalize(row) {
  if (!row) return null;
  return { ...row, metadata: safeJsonParse(row.metadata, {}) };
}

const AgentReportPublication = {
  get: async function (runId, sourcePath) {
    return normalize(
      await prisma.agent_report_publications.findUnique({
        where: {
          run_id_sourcePath: {
            run_id: String(runId),
            sourcePath: String(sourcePath),
          },
        },
      })
    );
  },

  begin: async function ({
    id,
    runId,
    workspaceId,
    sourcePath,
    contentHash,
    title,
    metadata = {},
  }) {
    return normalize(
      await prisma.agent_report_publications.upsert({
        where: {
          run_id_sourcePath: {
            run_id: String(runId),
            sourcePath: String(sourcePath),
          },
        },
        create: {
          id: String(id),
          run_id: String(runId),
          workspace_id: Number(workspaceId),
          sourcePath: String(sourcePath),
          contentHash: String(contentHash),
          title: String(title),
          status: "publishing",
          metadata: JSON.stringify(metadata || {}),
        },
        update: {
          status: "publishing",
          error: null,
          lastUpdatedAt: new Date(),
        },
      })
    );
  },

  complete: async function (id, { documentId, documentPath }) {
    return normalize(
      await prisma.agent_report_publications.update({
        where: { id: String(id) },
        data: {
          status: "published",
          documentId: Number(documentId),
          documentPath: String(documentPath),
          error: null,
          lastUpdatedAt: new Date(),
        },
      })
    );
  },

  fail: async function (id, error) {
    return normalize(
      await prisma.agent_report_publications.update({
        where: { id: String(id) },
        data: {
          status: "failed",
          error: String(error || "Publication failed").slice(0, 4_000),
          lastUpdatedAt: new Date(),
        },
      })
    );
  },

  forRun: async function (runId, { publishedOnly = true } = {}) {
    const rows = await prisma.agent_report_publications.findMany({
      where: {
        run_id: String(runId),
        ...(publishedOnly ? { status: "published" } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(normalize);
  },
};

module.exports = { AgentReportPublication, normalizePublication: normalize };
