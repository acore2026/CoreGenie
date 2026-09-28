const prisma = require("../utils/prisma");
const { validateWizard } = require("../utils/agentWizard");
const { createHash } = require("crypto");

function normalize(record) {
  return record
    ? { ...record, definition: JSON.parse(record.definition) }
    : null;
}

function dataFor(input) {
  const definition = { ...input.definition, id: input.key, title: input.title };
  if (input.description) definition.description = input.description;
  else delete definition.description;
  const value = require("../config-sync/database").quickTaskValue({
    ...definition,
    archived: input.archived === true,
  });
  const { archived, ...validated } = value;
  return {
    key: value.id,
    title: value.title,
    description: input.description || "",
    definition: JSON.stringify(validated),
    archived,
  };
}

async function validateBindings(client, ids, replacement = null) {
  const fail = (message) => {
    const error = new Error(message);
    error.code = "INVALID_QUICK_TASK";
    throw error;
  };
  if (
    !Array.isArray(ids) ||
    ids.length > 12 ||
    ids.some((id) => !Number.isInteger(id) || id < 1) ||
    new Set(ids).size !== ids.length
  )
    fail("最多绑定 12 个不重复的快捷任务。");
  if (!ids.length) return;
  const records = await client.predefined_quick_tasks.findMany({
    where: { id: { in: ids } },
  });
  if (records.length !== ids.length) fail("绑定的快捷任务不存在。");
  try {
    validateWizard(
      ids.map((id) => {
        const task = records.find((record) => record.id === id);
        return replacement?.id === id
          ? JSON.parse(replacement.definition)
          : JSON.parse(task.definition);
      })
    );
  } catch (error) {
    fail(error.message);
  }
}

async function validateTaskEdit(client, replacement) {
  const agents = await client.predefined_agents.findMany();
  for (const agent of agents) {
    const ids = JSON.parse(agent.quickTaskIds || "[]");
    if (ids.includes(replacement.id))
      await validateBindings(client, ids, replacement);
  }
}

async function importLegacy(client, wizard) {
  validateWizard(wizard);
  const tasks = wizard == null ? [] : Array.isArray(wizard) ? wizard : [wizard];
  const ids = [];
  for (const task of tasks) {
    const { id: oldId, ...content } = task;
    const matches = (record) => {
      if (!record || record.archived) return false;
      const { id: _id, ...saved } = JSON.parse(record.definition);
      return JSON.stringify(saved) === JSON.stringify(content);
    };
    const existing = oldId
      ? await client.predefined_quick_tasks.findUnique({
          where: { key: oldId },
        })
      : null;
    if (matches(existing)) {
      ids.push(existing.id);
      continue;
    }
    const baseKey =
      "legacy-" +
      createHash("sha256")
        .update(JSON.stringify(content))
        .digest("hex")
        .slice(0, 24);
    let key = baseKey;
    let suffix = 0;
    // A previously migrated task may since have been edited or archived.
    // Keep that shared record intact and preserve the newly submitted form.
    while (true) {
      const collision = await client.predefined_quick_tasks.findUnique({
        where: { key },
      });
      if (!collision || matches(collision)) break;
      key = `${baseKey}-${++suffix}`;
    }
    const record = await client.predefined_quick_tasks.upsert({
      where: { key },
      update: {},
      create: dataFor({
        key,
        title: task.title,
        description: task.description,
        definition: task,
      }),
    });
    if (!ids.includes(record.id)) ids.push(record.id);
  }
  return ids;
}

// Explicit bindings take precedence over the compatibility wizard returned to clients.
async function prepareBindings(client, data) {
  let ids = data.quickTaskIds;
  if (ids === undefined && Object.prototype.hasOwnProperty.call(data, "wizard"))
    ids = await importLegacy(client, data.wizard);
  if (ids === undefined) return {};
  await validateBindings(client, ids);
  return { quickTaskIds: JSON.stringify(ids), wizard: null };
}

// Content-derived keys make legacy imports repeatable without losing edits.
async function migrateLegacy(client = prisma) {
  const agents = await client.predefined_agents.findMany({
    where: { wizard: { not: null } },
  });
  for (const agent of agents) {
    const ids = JSON.parse(agent.quickTaskIds || "[]");
    for (const id of await importLegacy(client, JSON.parse(agent.wizard)))
      if (!ids.includes(id)) ids.push(id);
    await validateBindings(client, ids);
    await client.predefined_agents.update({
      where: { id: agent.id },
      data: { quickTaskIds: JSON.stringify(ids), wizard: null },
    });
  }
}

const PredefinedQuickTask = {
  all: async ({ includeArchived = false } = {}) =>
    (
      await prisma.predefined_quick_tasks.findMany({
        where: includeArchived ? undefined : { archived: false },
        orderBy: [{ title: "asc" }, { id: "asc" }],
      })
    ).map(normalize),
  get: async (id) =>
    normalize(
      await prisma.predefined_quick_tasks.findUnique({
        where: { id: Number(id) },
      })
    ),
  create: async (input) =>
    normalize(
      await prisma.predefined_quick_tasks.create({ data: dataFor(input) })
    ),
  update: async (id, input) => {
    const current = await PredefinedQuickTask.get(id);
    if (!current) return null;
    if (input.key !== current.key) throw new Error("快捷任务标识不能修改。");
    return prisma.$transaction(async (client) => {
      const data = { ...dataFor(input), lastUpdatedAt: new Date() };
      await validateTaskEdit(client, { id: Number(id), ...data });
      return normalize(
        await client.predefined_quick_tasks.update({
          where: { id: Number(id) },
          data,
        })
      );
    });
  },
  validateDefinition: (definition) => validateWizard([definition])[0],
  migrateLegacy,
};

require("../config-sync").synchronizeWrites(PredefinedQuickTask, [
  "create",
  "update",
]);
module.exports = {
  PredefinedQuickTask,
  migrateLegacy,
  prepareBindings,
  validateBindings,
  validateTaskEdit,
};
