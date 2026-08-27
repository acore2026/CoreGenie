const { composeAgentPrompt } = require("../resources/prompts");
const { selectedProvider } = require("../resources/models");
const {
  DEFAULT_RUNTIME_KEY,
  normalizeRuntimeConfig,
  runtimeDefinition,
} = require("./runtimes/registry");

function selectedModel(workspace, configuration = {}) {
  return (
    configuration.model ||
    workspace?.agentModel ||
    workspace?.chatModel ||
    (selectedProvider(workspace) === "openai"
      ? process.env.OPEN_MODEL_PREF
      : process.env.GENERIC_OPEN_AI_MODEL_PREF) ||
    null
  );
}

function agentSnapshot(agent) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || "",
    systemPrompt: agent.systemPrompt,
    tools: agent.tools,
    skillIds: agent.skillIds || [],
    skills: (agent.skills || []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description || "",
      instructions: skill.instructions,
    })),
  };
}

async function createRuntimeSnapshot({
  agent,
  workspace,
  user = null,
  configuration = {},
}) {
  const key = agent.runtimeKey || DEFAULT_RUNTIME_KEY;
  const definition = runtimeDefinition(key);
  const runtimeConfig = normalizeRuntimeConfig(key, agent.runtimeConfig || {});
  const fallbackModel = selectedModel(workspace, configuration);
  return {
    runtimeKey: definition.id,
    runtimeVersion: definition.version,
    runtimeSnapshot: {
      agent: agentSnapshot(agent),
      runtimeConfig,
      provider: selectedProvider(workspace),
      selectedModel: fallbackModel,
      roleModels: {
        controller:
          runtimeConfig.controllerModel ||
          runtimeConfig.plannerModel ||
          fallbackModel,
        planner:
          runtimeConfig.controllerModel ||
          runtimeConfig.plannerModel ||
          fallbackModel,
        worker: runtimeConfig.workerModel || fallbackModel,
        reviewer: runtimeConfig.reviewerModel || fallbackModel,
        vision: runtimeConfig.visionModel || fallbackModel,
        synthesizer:
          runtimeConfig.controllerModel ||
          runtimeConfig.plannerModel ||
          fallbackModel,
      },
      systemPrompt: await composeAgentPrompt({
        agent,
        user,
        workspace,
        runtimePrompt: configuration.systemPrompt || null,
      }),
      createdAt: new Date().toISOString(),
    },
  };
}

module.exports = { agentSnapshot, createRuntimeSnapshot, selectedModel };
