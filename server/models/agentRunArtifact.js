const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");
const { safeJsonParse } = require("../utils/http");

function normalizeArtifact(row) {
  if (!row) return null;
  return { ...row, metadata: safeJsonParse(row.metadata, {}) };
}

const AgentRunArtifact = {
  create: async function ({
    id = uuidv4(),
    runId,
    taskId = null,
    kind = "workspaceFile",
    title,
    mimeType = null,
    storagePath,
    content = null,
    metadata = {},
    byteSize = 0,
  }) {
    return normalizeArtifact(
      await prisma.agent_run_artifacts.create({
        data: {
          id: String(id),
          run_id: String(runId),
          task_id: taskId ? String(taskId) : null,
          kind: String(kind),
          title: String(title),
          mimeType: mimeType ? String(mimeType) : null,
          storagePath: storagePath ? String(storagePath) : null,
          content: content === null ? null : String(content),
          metadata: JSON.stringify(metadata || {}),
          byteSize: Math.max(0, Number(byteSize) || 0),
        },
      })
    );
  },

  forRun: async function (runId) {
    const rows = await prisma.agent_run_artifacts.findMany({
      where: { run_id: String(runId) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(normalizeArtifact);
  },
};

module.exports = { AgentRunArtifact, normalizeArtifact };
