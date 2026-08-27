const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const { PredefinedAgentSkill } = require("./predefinedAgentSkill");
const { SystemSettings } = require("./systemSettings");

function normalizeAgent(agent) {
  if (!agent) return null;
  const skillIds = safeJsonParse(agent.skillIds, [])
    .map(Number)
    .filter(Number.isInteger);
  return {
    ...agent,
    tools: agent.tools === null ? null : safeJsonParse(agent.tools, []),
    examplePrompts: safeJsonParse(agent.examplePrompts, []),
    runtimeKey: agent.runtimeKey || "default-react",
    runtimeConfig: safeJsonParse(agent.runtimeConfig, {}),
    skillIds,
    iconUrl: agent.iconFilename
      ? `/api/predefined-agents/${agent.id}/icon?v=${new Date(
          agent.lastUpdatedAt
        ).getTime()}`
      : null,
  };
}

const PredefinedAgent = {
  all: async function ({ enabledOnly = false } = {}) {
    try {
      const agents = await prisma.predefined_agents.findMany({
        where: enabledOnly ? { enabled: true } : undefined,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return agents.map(normalizeAgent);
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  get: async function (id, { enabledOnly = false, withSkills = false } = {}) {
    try {
      const record = await prisma.predefined_agents.findFirst({
        where: {
          id: Number(id),
          ...(enabledOnly ? { enabled: true } : {}),
        },
      });
      const agent = normalizeAgent(record);
      if (!agent || !withSkills) return agent;
      return {
        ...agent,
        skills: await PredefinedAgentSkill.whereIds(agent.skillIds),
      };
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  create: async function (data = {}) {
    try {
      const agent = await prisma.predefined_agents.create({
        data: {
          name: data.name,
          description: data.description || "",
          welcomeMessage: data.welcomeMessage || null,
          examplePrompts: JSON.stringify(data.examplePrompts || []),
          tools: data.tools === null ? null : JSON.stringify(data.tools || []),
          skillIds: JSON.stringify(data.skillIds || []),
          systemPrompt: data.systemPrompt,
          runtimeKey: data.runtimeKey || "default-react",
          runtimeConfig: JSON.stringify(data.runtimeConfig || {}),
          enabled: data.enabled !== false,
        },
      });
      return normalizeAgent(agent);
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  update: async function (id, data = {}) {
    try {
      const updates = { ...data, lastUpdatedAt: new Date() };
      if (Object.prototype.hasOwnProperty.call(updates, "tools"))
        updates.tools =
          updates.tools === null ? null : JSON.stringify(updates.tools || []);
      if (Object.prototype.hasOwnProperty.call(updates, "examplePrompts"))
        updates.examplePrompts = JSON.stringify(updates.examplePrompts || []);
      if (Object.prototype.hasOwnProperty.call(updates, "skillIds"))
        updates.skillIds = JSON.stringify(updates.skillIds || []);
      if (Object.prototype.hasOwnProperty.call(updates, "runtimeConfig"))
        updates.runtimeConfig = JSON.stringify(updates.runtimeConfig || {});
      const agent = await prisma.predefined_agents.update({
        where: { id: Number(id) },
        data: updates,
      });
      return normalizeAgent(agent);
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  delete: async function (id) {
    try {
      const agent = await this.get(id);
      if (!agent || agent.isBuiltinDefault) return false;
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
    const agent = await this.get(value, { enabledOnly: true });
    return agent?.id || null;
  },

  setDefault: async function (id) {
    const agent = await this.get(id, { enabledOnly: true });
    if (!agent) return false;
    const { success } = await SystemSettings.updateSettings({
      default_predefined_agent_id: agent.id,
    });
    return success;
  },
};

module.exports = { PredefinedAgent, normalizeAgent };
