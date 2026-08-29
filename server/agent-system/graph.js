const {
  createAgent,
  modelCallLimitMiddleware,
  humanInTheLoopMiddleware,
} = require("langchain");
const { createChatModel, selectedProvider } = require("../resources/models");
const { composeAgentPrompt } = require("../resources/prompts");
const { agentListForPrompt } = require("../resources/agents");
const { toolsForAgent, visibleToolDescriptorsForAgent } = require("../tools");
const { AgentToolContext } = require("../tools/context");
const { getCheckpointer } = require("./checkpointer");
const { AgentSkillWhitelist } = require("../models/agentSkillWhitelist");
const { reasoningOnlyFallbackMiddleware } = require("./modelMiddleware");
const { skillCatalogPrompt } = require("../agent-skills/registry");

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
  taskId = null,
  taskTitle = null,
  maxConsecutiveNoProgress = 5,
  onNoProgress = null,
  includeSkillCatalog = true,
  activatedSkillScope = null,
}) {
  const configuredAgent = Array.isArray(run.configuration?.toolOverrides)
    ? { ...agent, tools: run.configuration.toolOverrides }
    : agent;
  const allowActions =
    !["query", "chat"].includes(run.mode) && run.source !== "embed";
  const availableAgents = allowActions
    ? await agentListForPrompt(agent?.id)
    : [];
  const strictSelection = Array.isArray(run.configuration?.toolOverrides);
  const visibleToolIds = new Set(
    (disableTools
      ? []
      : visibleToolDescriptorsForAgent(configuredAgent, {
          allowActions,
          excludeToolIds,
          strictSelection,
        })
    ).map((descriptor) => descriptor.id)
  );
  const context = new AgentToolContext({
    run,
    workspace,
    user,
    agent: configuredAgent,
    emit,
    signal,
    approvalMode: run.configuration?.approvalMode || "always_allow",
    budget,
    depth,
    maxLocalToolCalls,
    taskId,
    taskTitle,
    visibleToolIds,
    maxConsecutiveNoProgress,
    onNoProgress,
    activatedSkillScope,
  });
  const tools = disableTools
    ? []
    : await toolsForAgent(configuredAgent, context, {
        allowActions,
        availableAgents,
        excludeToolIds,
        strictSelection,
      });
  const systemPrompt = systemPromptOverride
    ? [
        systemPromptOverride,
        includeSkillCatalog
          ? await skillCatalogPrompt(configuredAgent, workspace, null, {
              visibleToolIds,
            })
          : null,
      ]
        .filter(Boolean)
        .join("\n\n")
    : await composeAgentPrompt({
        agent: configuredAgent,
        user,
        workspace,
        runtimePrompt: run.configuration?.systemPrompt || null,
        visibleToolIds,
      });
  const modelOptions = {
    workspace,
    model: run.configuration?.model || null,
    temperature: run.configuration?.temperature,
    thinking: run.configuration?.thinking !== false,
  };
  const model = createChatModel(modelOptions);
  const middleware = [
    modelCallLimitMiddleware({
      runLimit: Math.min(
        Number(run.configuration?.maxModelCallsPerTask) || 150,
        500
      ),
      exitBehavior: "error",
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
              "knowledge_search",
              "web_fetch",
              "activate_skill",
              "read_skill_resource",
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
