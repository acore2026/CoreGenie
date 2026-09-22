const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const { withPrismaRetry } = require("../utils/prismaRetry");

const JSON_FIELDS = [
  "dependsOn",
  "allowedToolIds",
  "requiredCapabilities",
  "successCriteria",
  "budget",
];

function normalizeTask(row) {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      JSON_FIELDS.includes(key)
        ? safeJsonParse(value, key === "budget" ? {} : [])
        : value,
    ])
  );
}

function serializeTask(task) {
  const data = { ...task };
  for (const field of JSON_FIELDS) {
    if (Object.hasOwn(data, field))
      data[field] = JSON.stringify(
        data[field] || (field === "budget" ? {} : [])
      );
  }
  return data;
}

const AgentRunTask = {
  list: async function (runId) {
    const rows = await prisma.agent_run_tasks.findMany({
      where: { run_id: String(runId) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(normalizeTask);
  },

  get: async function (id) {
    return normalizeTask(
      await prisma.agent_run_tasks.findUnique({ where: { id: String(id) } })
    );
  },

  upsertPlan: async function (runId, tasks = []) {
    const rows = [];
    for (const task of tasks) {
      const data = serializeTask({
        parent_task_id: task.parentTaskId || null,
        title: task.title,
        objective: task.objective,
        agent_id: task.assignedAgentId ? Number(task.assignedAgentId) : null,
        dependsOn: task.dependsOn || [],
        allowedToolIds: task.allowedToolIds || [],
        requiredCapabilities: task.requiredCapabilities || [],
        successCriteria: task.successCriteria || [],
        acceptsPartialDependencies: Boolean(task.acceptsPartialDependencies),
        writeIntent: Boolean(task.writeIntent),
        maxAttempts: Number(task.maxAttempts) || 2,
        budget: task.budget || {},
        lastUpdatedAt: new Date(),
      });
      const row = await withPrismaRetry(() =>
        prisma.agent_run_tasks.upsert({
          where: { id: String(task.id) },
          create: {
            id: String(task.id),
            run_id: String(runId),
            ...data,
          },
          update: data,
        })
      );
      rows.push(normalizeTask(row));
    }
    return rows;
  },

  saveProgressPlan: async function (runId, tasks) {
    const prefix = `${runId}:plan:`;
    return withPrismaRetry(() =>
      prisma.$transaction(async (client) => {
        const previous = await client.agent_run_tasks.findMany({
          where: { run_id: String(runId) },
        });
        const incoming = new Set(tasks.map((task) => `${prefix}${task.id}`));
        if (previous.some((task) => !incoming.has(task.id)))
          throw new Error("请保留已有任务；不再需要的步骤请标记为跳过。");
        const rows = [];
        for (const [order, task] of tasks.entries()) {
          const id = `${prefix}${task.id}`;
          const old = previous.find((item) => item.id === id);
          const data = {
            title: task.title,
            objective: task.title,
            status: task.status,
            progress: task.detail || null,
            error: task.status === "failed" ? task.detail || null : null,
            resultSummary:
              task.status === "completed" ? task.detail || task.title : null,
            budget: JSON.stringify({ planOrder: order }),
            startedAt:
              old?.startedAt || (task.status === "running" ? new Date() : null),
            completedAt: ["completed", "failed", "skipped"].includes(
              task.status
            )
              ? old?.completedAt || new Date()
              : null,
            lastUpdatedAt: new Date(),
          };
          rows.push(
            normalizeTask(
              await client.agent_run_tasks.upsert({
                where: { id },
                create: { id, run_id: String(runId), ...data },
                update: data,
              })
            )
          );
        }
        return rows;
      })
    );
  },

  update: async function (id, data = {}) {
    return normalizeTask(
      await withPrismaRetry(() =>
        prisma.agent_run_tasks.update({
          where: { id: String(id) },
          data: serializeTask({ ...data, lastUpdatedAt: new Date() }),
        })
      )
    );
  },

  reconcileTerminal: async function (runId, status = "failed") {
    await withPrismaRetry(() =>
      prisma.agent_run_tasks.updateMany({
        where: {
          run_id: String(runId),
          status: { in: ["pending", "queued", "running", "retrying"] },
        },
        data: {
          status,
          error: "The run ended before this task completed.",
          completedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      })
    );
  },
};

module.exports = { AgentRunTask, normalizeTask };
