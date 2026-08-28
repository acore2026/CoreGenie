const { PredefinedAgent } = require("../models/predefinedAgent");

async function resolveAgent(agentId = null) {
  await require("../agent-skills/seed").seedBuiltinSkills();
  if (agentId) {
    const selected = await PredefinedAgent.get(agentId, {
      enabledOnly: true,
      withSkills: true,
    });
    if (selected) return selected;
  }

  const defaultId = await PredefinedAgent.defaultId();
  if (defaultId) {
    const selected = await PredefinedAgent.get(defaultId, {
      enabledOnly: true,
      withSkills: true,
    });
    if (selected) return selected;
  }

  const agents = await PredefinedAgent.all({ enabledOnly: true });
  const builtin = agents.find((agent) => agent.isBuiltinDefault) || agents[0];
  return builtin
    ? PredefinedAgent.get(builtin.id, { enabledOnly: true, withSkills: true })
    : null;
}

async function agentListForPrompt(currentAgentId = null) {
  const agents = await PredefinedAgent.all({ enabledOnly: true });
  return agents
    .filter((agent) => agent.id !== currentAgentId)
    .map(({ id, name, description, tools }) => ({
      id,
      name,
      description,
      tools,
    }));
}

module.exports = { resolveAgent, agentListForPrompt };
