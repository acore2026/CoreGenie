const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");
const { safeJsonParse } = require("../utils/http");
const { createHash } = require("crypto");

function normalizeArtifact(row) {
  if (!row) return null;
  return { ...row, metadata: safeJsonParse(row.metadata, {}) };
}

const AgentRunArtifact = {
  // Stable identity keeps appends, retries and concurrent workers on one card.
  registerWorkspaceOutput: async function (data) {
    const id = createHash("sha256")
      .update(`${data.runId}\0${data.storagePath}`)
      .digest("hex");
    const values = {
      kind: data.kind,
      title: data.title,
      mimeType: data.mimeType,
      byteSize: data.byteSize,
      metadata: JSON.stringify(data.metadata || {}),
    };
    return normalizeArtifact(
      await prisma.agent_run_artifacts.upsert({
        where: { id },
        create: {
          id,
          run_id: String(data.runId),
          task_id: data.taskId || null,
          storagePath: data.storagePath,
          ...values,
        },
        update: values,
      })
    );
  },
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
