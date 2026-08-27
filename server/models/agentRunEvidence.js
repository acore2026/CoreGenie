const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

function normalizeEvidence(row) {
  if (!row) return null;
  return { ...row, metadata: safeJsonParse(row.metadata, {}) };
}

const AgentRunEvidence = {
  list: async function (runId) {
    const rows = await prisma.agent_run_evidence.findMany({
      where: { run_id: String(runId) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(normalizeEvidence);
  },

  upsertMany: async function (runId, taskId, evidence = []) {
    const rows = [];
    for (const item of evidence) {
      const row = await prisma.agent_run_evidence.upsert({
        where: { id: String(item.id) },
        create: {
          id: String(item.id),
          run_id: String(runId),
          task_id: taskId || null,
          tool_execution_id: item.toolExecutionId || null,
          kind: item.kind || "tool",
          title: item.title || "Evidence",
          uri: item.uri || null,
          excerpt: String(item.excerpt || ""),
          metadata: JSON.stringify(item.metadata || {}),
          usedInFinal: Boolean(item.usedInFinal),
        },
        update: {
          excerpt: String(item.excerpt || ""),
          metadata: JSON.stringify(item.metadata || {}),
          usedInFinal: Boolean(item.usedInFinal),
        },
      });
      rows.push(normalizeEvidence(row));
    }
    return rows;
  },

  markUsed: async function (ids = []) {
    if (!ids.length) return;
    await prisma.agent_run_evidence.updateMany({
      where: { id: { in: ids.map(String) } },
      data: { usedInFinal: true },
    });
  },
};

module.exports = { AgentRunEvidence, normalizeEvidence };
