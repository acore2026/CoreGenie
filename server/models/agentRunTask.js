const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

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
      const row = await prisma.agent_run_tasks.upsert({
        where: { id: String(task.id) },
        create: {
          id: String(task.id),
          run_id: String(runId),
          ...data,
        },
        update: data,
      });
      rows.push(normalizeTask(row));
    }
    return rows;
  },

  update: async function (id, data = {}) {
    return normalizeTask(
      await prisma.agent_run_tasks.update({
        where: { id: String(id) },
        data: serializeTask({ ...data, lastUpdatedAt: new Date() }),
      })
    );
  },

  reconcileTerminal: async function (runId, status = "failed") {
    await prisma.agent_run_tasks.updateMany({
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
    });
  },
};

module.exports = { AgentRunTask, normalizeTask };
