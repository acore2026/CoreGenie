const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");
const { safeJsonParse } = require("../utils/http");

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function normalizeRun(run) {
  if (!run) return null;
  return {
    ...run,
    attachments: safeJsonParse(run.attachments, []),
    configuration: safeJsonParse(run.configuration, {}),
    runtimeKey: run.runtimeKey || "default-react",
    runtimeVersion: Number(run.runtimeVersion) || 1,
    runtimeSnapshot: safeJsonParse(run.runtimeSnapshot, {}),
  };
}

const AgentRun = {
  TERMINAL_STATUSES,

  create: async function ({
    workspaceId,
    threadId = null,
    userId = null,
    agentId = null,
    source = "workspace",
    mode = "automatic",
    prompt,
    attachments = [],
    configuration = {},
    runtimeKey = "default-react",
    runtimeVersion = 1,
    runtimeSnapshot = {},
  }) {
    const id = uuidv4();
    const run = await prisma.agent_runs.create({
      data: {
        id,
        workspace_id: Number(workspaceId),
        thread_id: threadId ? Number(threadId) : null,
        user_id: userId ? Number(userId) : null,
        agent_id: agentId ? Number(agentId) : null,
        source,
        mode,
        prompt: String(prompt),
        attachments: JSON.stringify(attachments || []),
        configuration: JSON.stringify(configuration || {}),
        runtimeKey,
        runtimeVersion: Number(runtimeVersion) || 1,
        runtimeSnapshot: JSON.stringify(runtimeSnapshot || {}),
        checkpointThreadId:
          runtimeKey === "default-react"
            ? `agent-run:${id}`
            : `custom:${Number(runtimeVersion) || 1}:${id}`,
      },
    });
    return normalizeRun(run);
  },

  get: async function (id) {
    return normalizeRun(
      await prisma.agent_runs.findUnique({ where: { id: String(id) } })
    );
  },

  update: async function (id, data = {}) {
    const updates = { ...data, lastUpdatedAt: new Date() };
    if (Object.hasOwn(updates, "attachments"))
      updates.attachments = JSON.stringify(updates.attachments || []);
    if (Object.hasOwn(updates, "configuration"))
      updates.configuration = JSON.stringify(updates.configuration || {});
    if (Object.hasOwn(updates, "runtimeSnapshot"))
      updates.runtimeSnapshot = JSON.stringify(updates.runtimeSnapshot || {});
    return normalizeRun(
      await prisma.agent_runs.update({
        where: { id: String(id) },
        data: updates,
      })
    );
  },

  activeForConversation: async function ({ workspaceId, threadId, userId }) {
    const run = await prisma.agent_runs.findFirst({
      where: {
        workspace_id: Number(workspaceId),
        thread_id: threadId ? Number(threadId) : null,
        user_id: userId ? Number(userId) : null,
        status: {
          in: [
            "queued",
            "running",
            "waiting_for_input",
            "waiting_for_approval",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return normalizeRun(run);
  },

  queued: async function (take = 20) {
    const rows = await prisma.agent_runs.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take,
    });
    return rows.map(normalizeRun);
  },

  isTerminal(status) {
    return TERMINAL_STATUSES.has(status);
  },
};

module.exports = { AgentRun, normalizeRun };
