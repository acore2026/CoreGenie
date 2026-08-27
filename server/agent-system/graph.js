const {
  createAgent,
  toolCallLimitMiddleware,
  humanInTheLoopMiddleware,
} = require("langchain");
const { createChatModel, selectedProvider } = require("../resources/models");
const { composeAgentPrompt } = require("../resources/prompts");
const { agentListForPrompt } = require("../resources/agents");
const { toolsForAgent } = require("../tools");
const { AgentToolContext } = require("../tools/context");
const { getCheckpointer } = require("./checkpointer");
const { AgentSkillWhitelist } = require("../models/agentSkillWhitelist");
const { reasoningOnlyFallbackMiddleware } = require("./modelMiddleware");

async function buildAgentGraph({
  run,
  workspace,
  user,
  agent,
  emit,
  signal,
  budget = null,
  depth = 0,
  maxLocalToolCalls = null,
  systemPromptOverride = null,
  checkpointerOverride = null,
  excludeToolIds = [],
  disableTools = false,
}) {
  const context = new AgentToolContext({
    run,
    workspace,
    user,
    agent,
    emit,
    signal,
    approvalMode: run.configuration?.approvalMode || "always_allow",
    budget,
    depth,
    maxLocalToolCalls,
  });
  const allowActions =
    !["query", "chat"].includes(run.mode) && run.source !== "embed";
  const availableAgents = allowActions
    ? await agentListForPrompt(agent?.id)
    : [];
  const configuredAgent = Array.isArray(run.configuration?.toolOverrides)
    ? { ...agent, tools: run.configuration.toolOverrides }
    : agent;
  const tools = disableTools
    ? []
    : await toolsForAgent(configuredAgent, context, {
        allowActions,
        availableAgents,
        excludeToolIds,
      });
  const systemPrompt =
    systemPromptOverride ||
    (await composeAgentPrompt({
      agent,
      user,
      workspace,
      runtimePrompt: run.configuration?.systemPrompt || null,
    }));
  const modelOptions = {
    workspace,
    model: run.configuration?.model || null,
    temperature: run.configuration?.temperature,
    thinking: run.configuration?.thinking !== false,
  };
  const model = createChatModel(modelOptions);
  const middleware = [
    toolCallLimitMiddleware({
      runLimit: Math.min(Number(run.configuration?.maxToolCalls) || 500, 500),
      exitBehavior: "end",
    }),
  ];
  if (
    selectedProvider(workspace) === "generic-openai" &&
    modelOptions.thinking !== false
  ) {
    middleware.push(
      reasoningOnlyFallbackMiddleware(() =>
        createChatModel({ ...modelOptions, thinking: false })
      )
    );
  }
  if (context.approvalMode === "ask" && allowActions) {
    const whitelisted = new Set(
      await AgentSkillWhitelist.get(user?.id || null)
    );
    const interruptOn = Object.fromEntries(
      tools
        .map((tool) => tool.name)
        .filter(
          (name) =>
            !whitelisted.has(name) &&
            ![
              "filesystem_read",
              "filesystem_list",
              "filesystem_search",
              "memory_recall",
              "rag_search",
              "web_fetch",
            ].includes(name)
        )
        .map((name) => [
          name,
          {
            allowedDecisions: ["approve", "reject"],
            description: `Approve ${name} execution`,
          },
        ])
    );
    if (Object.keys(interruptOn).length)
      middleware.push(humanInTheLoopMiddleware({ interruptOn }));
  }

  return createAgent({
    name: `agent_${agent?.id || "default"}`,
    description: agent?.description || "AnythingLLM Agent",
    model,
    tools,
    systemPrompt,
    checkpointer: checkpointerOverride || getCheckpointer(),
    middleware,
  });
}

module.exports = { buildAgentGraph };
