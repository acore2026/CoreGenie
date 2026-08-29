/* eslint-env jest, node */
const mockCreate = jest.fn();
const mockAppend = jest.fn();
const mockEnqueue = jest.fn();

jest.mock("../../models/agentRun", () => ({
  AgentRun: {
    activeForConversation: jest.fn().mockResolvedValue(null),
    create: (...args) => mockCreate(...args),
  },
}));
jest.mock("../../models/agentRunEvent", () => ({
  AgentRunEvent: { append: (...args) => mockAppend(...args) },
}));
jest.mock("../../models/agentSkillWhitelist", () => ({
  AgentSkillWhitelist: { getApprovalMode: jest.fn() },
}));
jest.mock("../../agent-system/supervisor", () => ({
  agentRunSupervisor: { enqueue: (...args) => mockEnqueue(...args) },
}));
jest.mock("../../resources/agents", () => ({
  resolveAgent: jest.fn().mockResolvedValue({ id: 6 }),
}));
jest.mock("../../agent-system/runtimeSnapshot", () => ({
  createRuntimeSnapshot: jest.fn().mockResolvedValue({
    runtimeKey: "governed-agent",
    runtimeVersion: 1,
    runtimeSnapshot: {},
  }),
}));
jest.mock("../../agent-system/concurrency", () => ({
  agentMaxConcurrency: jest.fn().mockReturnValue(6),
}));
jest.mock("../../models/systemSettings", () => ({
  SystemSettings: {
    agentExecutionLimitsDisabled: jest.fn().mockResolvedValue(true),
  },
}));

const { submitAgentRun } = require("../../agent-system/service");

describe("submitAgentRun execution limit override", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockImplementation(async (input) => ({ id: "run-1", ...input }));
  });

  it("stores an unlimited execution snapshot for new runs", async () => {
    await submitAgentRun({
      workspace: { id: 7, chatMode: "automatic" },
      thread: { id: 104 },
      user: { id: 2 },
      prompt: "分析 KI#22",
      source: "workspace",
      configuration: { approvalMode: "always_allow" },
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          disableExecutionLimits: true,
          maxRuntimeMs: null,
          maxModelCallsPerTask: null,
          maxToolCalls: null,
        }),
        policySnapshot: expect.objectContaining({
          disableExecutionLimits: true,
          maxRuntimeMs: null,
          maxTaskModelCalls: null,
          maxTaskToolCalls: null,
          maxToolCalls: null,
        }),
      })
    );
  });
});
