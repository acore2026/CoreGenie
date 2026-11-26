jest.mock("langchain", () => ({
  createAgent: jest.fn((options) => options),
  modelCallLimitMiddleware: jest.fn(() => ({ name: "limits" })),
  humanInTheLoopMiddleware: jest.fn(),
}));
jest.mock("../../resources/models", () => ({
  createChatModel: jest.fn(() => ({ id: "model" })),
  selectedProvider: jest.fn(() => "openai"),
}));
jest.mock("../../resources/prompts", () => ({
  composeAgentPrompt: jest.fn(async () => "system instructions"),
}));
jest.mock("../../resources/agents", () => ({
  agentListForPrompt: jest.fn(async () => []),
}));
jest.mock("../../tools", () => ({
  toolsForAgent: jest.fn(async () => []),
  visibleToolDescriptorsForAgent: jest.fn(() => []),
}));
jest.mock("../../tools/context", () => ({
  AgentToolContext: class {
    constructor() {
      this.approvalMode = "always_allow";
    }
  },
}));
jest.mock("../../agent-system/checkpointer", () => ({
  getCheckpointer: jest.fn(async () => ({})),
}));
jest.mock("../../models/agentSkillWhitelist", () => ({
  AgentSkillWhitelist: {},
}));
jest.mock("../../agent-skills/registry", () => ({
  skillCatalogPrompt: jest.fn(async () => ""),
}));
jest.mock("../../agent-system/contextCompaction", () => ({
  contextCompactionMiddleware: jest.fn(() => ({ name: "ContextCompaction" })),
  SUMMARY_TOKENS: 4000,
}));
const { buildAgentGraph } = require("../../agent-system/graph");
const {
  contextCompactionMiddleware,
} = require("../../agent-system/contextCompaction");
const { createChatModel } = require("../../resources/models");
beforeEach(() => jest.clearAllMocks());

it.each([
  ["default-react", undefined],
  ["default-react", false],
  ["default-react", "true"],
  ["governed-agent", true],
  ["evidence-research", true],
])("does not enable compaction for %s / %s", async (runtimeKey, enabled) => {
  await buildAgentGraph({
    run: {
      runtimeKey,
      mode: "chat",
      configuration: { contextCompactionEnabled: enabled },
    },
    workspace: {},
    agent: {},
    disableTools: true,
  });
  expect(contextCompactionMiddleware).not.toHaveBeenCalled();
});
it("enables only opted-in ReAct and does not couple it to execution-limit overrides", async () => {
  const result = await buildAgentGraph({
    run: {
      runtimeKey: "default-react",
      mode: "chat",
      configuration: {
        contextCompactionEnabled: true,
        disableExecutionLimits: true,
        model: "GLM-5.3-CodeAgent",
      },
    },
    workspace: {},
    agent: {},
    disableTools: true,
  });
  expect(result.middleware.map((item) => item.name)).toEqual([
    "ContextCompaction",
  ]);
  const options = contextCompactionMiddleware.mock.calls[0][0];
  options.createSummaryModel();
  expect(createChatModel).toHaveBeenLastCalledWith(
    expect.objectContaining({
      model: "GLM-5.3-CodeAgent",
      maxTokens: 4000,
      maxRetries: 0,
      thinking: false,
    })
  );
});
