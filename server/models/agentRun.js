const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");
const { safeJsonParse } = require("../utils/http");
const { withPrismaRetry } = require("../utils/prismaRetry");

const TERMINAL_STATUSES = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

function normalizeRun(run) {
  if (!run) return null;
  return {
    ...run,
    attachments: safeJsonParse(run.attachments, []),
    configuration: safeJsonParse(run.configuration, {}),
    runtimeKey: run.runtimeKey || "governed-agent",
    runtimeVersion: Number(run.runtimeVersion) || 1,
    runtimeSnapshot: safeJsonParse(run.runtimeSnapshot, {}),
    policySnapshot: safeJsonParse(run.policySnapshot, {}),
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
    parentRunId = null,
    policySnapshot = {},
  }) {
    const id = uuidv4();
    const run = await withPrismaRetry(() =>
      prisma.agent_runs.create({
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
          parent_run_id: parentRunId ? String(parentRunId) : null,
          policySnapshot: JSON.stringify(policySnapshot || {}),
          checkpointThreadId:
            runtimeKey === "evidence-research"
              ? `custom:${Number(runtimeVersion) || 1}:${id}`
              : `agent-run:${id}`,
        },
      })
    );
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
    if (Object.hasOwn(updates, "policySnapshot"))
      updates.policySnapshot = JSON.stringify(updates.policySnapshot || {});
    return normalizeRun(
      await withPrismaRetry(() =>
        prisma.agent_runs.update({
          where: { id: String(id) },
          data: updates,
        })
      )
    );
  },

  activeForConversation: async function ({ workspaceId, threadId, userId }) {
    const run = await prisma.agent_runs.findFirst({
      where: {
        workspace_id: Number(workspaceId),
        thread_id: threadId ? Number(threadId) : null,
        // A thread already identifies the conversation. Keeping the viewer's
        // user_id in this query prevents another workspace member (including
        // an admin) from reconnecting to the thread owner's active run.
        ...(threadId ? {} : { user_id: userId ? Number(userId) : null }),
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

  deleteForWorkspace: async function (workspaceId) {
    const parsed = Number(workspaceId);
    if (!Number.isInteger(parsed) || parsed < 1) return 0;
    const result = await withPrismaRetry(() =>
      prisma.agent_runs.deleteMany({ where: { workspace_id: parsed } })
    );
    return result.count;
  },

  claim: async function (id, owner, leaseMs = 30_000) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const claimed = await withPrismaRetry(() =>
      prisma.agent_runs.updateMany({
        where: {
          id: String(id),
          status: { in: ["queued", "running"] },
          OR: [
            { leaseOwner: null },
            { leaseOwner: String(owner) },
            { leaseExpiresAt: { lt: now } },
          ],
        },
        data: {
          leaseOwner: String(owner),
          leaseExpiresAt,
          heartbeatAt: now,
        },
      })
    );
    if (!claimed.count) return null;
    return this.get(id);
  },

  heartbeat: async function (id, owner, leaseMs = 30_000) {
    const now = new Date();
    const updated = await withPrismaRetry(() =>
      prisma.agent_runs.updateMany({
        where: { id: String(id), leaseOwner: String(owner) },
        data: {
          heartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
        },
      })
    );
    return updated.count === 1;
  },

  releaseLease: async function (id, owner = null) {
    await withPrismaRetry(() =>
      prisma.agent_runs.updateMany({
        where: {
          id: String(id),
          ...(owner ? { leaseOwner: String(owner) } : {}),
        },
        data: { leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null },
      })
    );
  },

  reclaimable: async function (take = 100) {
    const now = new Date();
    const rows = await prisma.agent_runs.findMany({
      where: {
        OR: [
          { status: "queued" },
          { status: "running", leaseExpiresAt: { lt: now } },
          { status: "running", leaseExpiresAt: null },
        ],
      },
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
