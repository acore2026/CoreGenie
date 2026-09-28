const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const { PredefinedAgentSkill } = require("./predefinedAgentSkill");
const { SystemSettings } = require("./systemSettings");
const { DEFAULT_RUNTIME_KEY } = require("../agent-system/runtimes/registry");

function normalizeAgent(agent) {
  if (!agent) return null;
  const skillIds = safeJsonParse(agent.skillIds, [])
    .map(Number)
    .filter(Number.isInteger);
  const quickTaskIds = safeJsonParse(agent.quickTaskIds, [])
    .map(Number)
    .filter(Number.isInteger);
  return {
    ...agent,
    tools: agent.tools === null ? null : safeJsonParse(agent.tools, []),
    examplePrompts: safeJsonParse(agent.examplePrompts, []),
    wizard: safeJsonParse(agent.wizard, null),
    runtimeKey: agent.runtimeKey || DEFAULT_RUNTIME_KEY,
    runtimeConfig: safeJsonParse(agent.runtimeConfig, {}),
    skillIds,
    quickTaskIds,
    iconUrl: agent.iconFilename
      ? `/api/predefined-agents/${agent.id}/icon?v=${new Date(
          agent.lastUpdatedAt
        ).getTime()}`
      : null,
  };
}

async function resolveQuickTasks(agents) {
  if (!agents.some((agent) => agent?.quickTaskIds.length)) return agents;
  const tasks =
    await require("./predefinedQuickTask").PredefinedQuickTask.all();
  return agents.map((agent) =>
    agent
      ? {
          ...agent,
          wizard: agent.quickTaskIds.length
            ? agent.quickTaskIds
                .map((id) => tasks.find((task) => task.id === id)?.definition)
                .filter(Boolean)
            : agent.wizard,
        }
      : null
  );
}

const PredefinedAgent = {
  all: async function ({ enabledOnly = false, rosterOnly = false } = {}) {
    try {
      const where = {
        ...(enabledOnly ? { enabled: true } : {}),
        ...(rosterOnly ? { showInRoster: true } : {}),
      };
      const agents = await prisma.predefined_agents.findMany({
        where: Object.keys(where).length ? where : undefined,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return await resolveQuickTasks(agents.map(normalizeAgent));
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  get: async function (
    id,
    {
      enabledOnly = false,
      rosterOnly = false,
      withSkills = false,
      withQuickTasks = false,
    } = {}
  ) {
    try {
      const record = await prisma.predefined_agents.findFirst({
        where: {
          id: Number(id),
          ...(enabledOnly ? { enabled: true } : {}),
          ...(rosterOnly ? { showInRoster: true } : {}),
        },
      });
      const [agent] = await resolveQuickTasks([normalizeAgent(record)]);
      if (!agent || (!withSkills && !withQuickTasks)) return agent;
      return {
        ...agent,
        ...(withSkills
          ? { skills: await PredefinedAgentSkill.whereIds(agent.skillIds) }
          : {}),
        ...(withQuickTasks
          ? {
              quickTasks: await require("./predefinedQuickTask")
                .PredefinedQuickTask.all({ includeArchived: true })
                .then((tasks) =>
                  tasks.filter((task) => agent.quickTaskIds.includes(task.id))
                ),
            }
          : {}),
      };
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  create: async function (data = {}) {
    try {
      const agent = await prisma.$transaction(async (client) => {
        const bindings = await require("./predefinedQuickTask").prepareBindings(
          client,
          data
        );
        return client.predefined_agents.create({
          data: {
            name: data.name,
            description: data.description || "",
            welcomeMessage: data.welcomeMessage || null,
            examplePrompts: JSON.stringify(data.examplePrompts || []),
            wizard: data.wizard == null ? null : JSON.stringify(data.wizard),
            tools:
              data.tools === null ? null : JSON.stringify(data.tools || []),
            skillIds: JSON.stringify(data.skillIds || []),
            quickTaskIds: JSON.stringify(data.quickTaskIds || []),
            systemPrompt: data.systemPrompt,
            runtimeKey: data.runtimeKey || DEFAULT_RUNTIME_KEY,
            runtimeConfig: JSON.stringify(data.runtimeConfig || {}),
            enabled: data.enabled !== false,
            showInRoster: data.showInRoster !== false,
            ...bindings,
          },
        });
      });
      return (await resolveQuickTasks([normalizeAgent(agent)]))[0];
    } catch (error) {
      if (error.code === "INVALID_QUICK_TASK") throw error;
      console.error(error.message);
      return null;
    }
  },

  update: async function (id, data = {}) {
    try {
      const updates = { ...data, lastUpdatedAt: new Date() };
      if (Object.prototype.hasOwnProperty.call(updates, "wizard"))
        updates.wizard =
          updates.wizard == null ? null : JSON.stringify(updates.wizard);
      if (Object.prototype.hasOwnProperty.call(updates, "tools"))
        updates.tools =
          updates.tools === null ? null : JSON.stringify(updates.tools || []);
      if (Object.prototype.hasOwnProperty.call(updates, "examplePrompts"))
        updates.examplePrompts = JSON.stringify(updates.examplePrompts || []);
      if (Object.prototype.hasOwnProperty.call(updates, "skillIds"))
        updates.skillIds = JSON.stringify(updates.skillIds || []);
      if (Object.prototype.hasOwnProperty.call(updates, "quickTaskIds"))
        updates.quickTaskIds = JSON.stringify(updates.quickTaskIds || []);
      if (Object.prototype.hasOwnProperty.call(updates, "runtimeConfig"))
        updates.runtimeConfig = JSON.stringify(updates.runtimeConfig || {});
      const agent = await prisma.$transaction(async (client) => {
        const bindings = await require("./predefinedQuickTask").prepareBindings(
          client,
          data
        );
        return client.predefined_agents.update({
          where: { id: Number(id) },
          data: { ...updates, ...bindings },
        });
      });
      return (await resolveQuickTasks([normalizeAgent(agent)]))[0];
    } catch (error) {
      if (error.code === "INVALID_QUICK_TASK") throw error;
      console.error(error.message);
      return null;
    }
  },

  delete: async function (id) {
    try {
      const agent = await this.get(id);
      if (!agent || agent.isBuiltinDefault) return false;
      if (require("../config-sync").enabled()) {
        return !!(await this.update(id, { enabled: false }));
      }
      await prisma.predefined_agents.delete({ where: { id: Number(id) } });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  defaultId: async function () {
    const value = Number(
      await SystemSettings.getValueOrFallback(
        { label: "default_predefined_agent_id" },
        null
      )
    );
    if (!Number.isInteger(value) || value < 1) return null;
    const agent = await this.get(value, {
      enabledOnly: true,
      rosterOnly: true,
    });
    return agent?.id || null;
  },

  setDefault: async function (id) {
    const agent = await this.get(id, {
      enabledOnly: true,
      rosterOnly: true,
    });
    if (!agent) return false;
    const { success } = await SystemSettings.updateSettings({
      default_predefined_agent_id: agent.id,
    });
    return success;
  },
};

require("../config-sync").synchronizeWrites(PredefinedAgent, [
  "create",
  "update",
  "delete",
]);

module.exports = { PredefinedAgent, normalizeAgent };
