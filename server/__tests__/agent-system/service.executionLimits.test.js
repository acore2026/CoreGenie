/* eslint-env jest, node */
const mockCreate = jest.fn();
const mockAppend = jest.fn();
const mockEnqueue = jest.fn();

jest.mock("../../models/threadLifecycle", () => ({
  acceptThreadSubmission: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../models/agentRun", () => ({
  AgentRun: {
    activeForConversation: jest.fn().mockResolvedValue(null),
    create: (...args) => mockCreate(...args),
  },
}));
jest.mock("../../models/agentRunEvent", () => ({
  AgentRunEvent: { append: (...args) => mockAppend(...args) },
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
    agentSkillToolRestrictionsEnabled: jest.fn().mockResolvedValue(false),
    agentContextCompactionEnabled: jest.fn().mockResolvedValue(false),
  },
}));

const { submitAgentRun } = require("../../agent-system/service");
const { resolveAgent } = require("../../resources/agents");
const { SystemSettings } = require("../../models/systemSettings");
const { acceptThreadSubmission } = require("../../models/threadLifecycle");

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

    expect(acceptThreadSubmission).toHaveBeenCalledWith(104);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          disableExecutionLimits: true,
          enforceSkillToolRestrictions: false,
          maxRuntimeMs: null,
          maxModelCallsPerTask: null,
          maxToolCalls: null,
        }),
        policySnapshot: expect.objectContaining({
          disableExecutionLimits: true,
          enforceSkillToolRestrictions: false,
          maxRuntimeMs: null,
          maxTaskModelCalls: null,
          maxTaskToolCalls: null,
          maxToolCalls: null,
        }),
      })
    );
  });

  it("always allows tools even when a caller requests approval prompts", async () => {
    await submitAgentRun({
      workspace: { id: 7, chatMode: "automatic" },
      thread: { id: 106 },
      user: { id: 2 },
      prompt: "分析 KI#22",
      source: "workspace",
      configuration: { approvalMode: "ask" },
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          approvalMode: "always_allow",
        }),
        policySnapshot: expect.objectContaining({
          approvalMode: "always_allow",
        }),
      })
    );
  });

  it.each([
    [
      {},
      {
        maxRuntimeMs: 14_400_000,
        maxModelCallsPerTask: 80,
        maxToolCalls: 10_000,
      },
    ],
    [
      { maxRuntimeMs: 600_000, maxModelCallsPerTask: 12, maxToolCalls: 50 },
      { maxRuntimeMs: 600_000, maxModelCallsPerTask: 12, maxToolCalls: 50 },
    ],
    [
      {
        maxRuntimeMs: 100_000_000,
        maxModelCallsPerTask: 999,
        maxToolCalls: 99_999,
      },
      {
        maxRuntimeMs: 86_400_000,
        maxModelCallsPerTask: 500,
        maxToolCalls: 10_000,
      },
    ],
  ])(
    "uses generous defaults while respecting explicit budgets",
    async (configuration, expected) => {
      SystemSettings.agentExecutionLimitsDisabled.mockResolvedValueOnce(false);
      await submitAgentRun({
        workspace: { id: 7 },
        prompt: "分析提案",
        configuration,
      });
      expect(mockCreate.mock.calls[0][0].configuration).toMatchObject(expected);
    }
  );

  it("allows a single-context Agent to disable only the model call limit", async () => {
    SystemSettings.agentExecutionLimitsDisabled.mockResolvedValueOnce(false);
    resolveAgent.mockResolvedValueOnce({
      id: 9,
      runtimeConfig: {
        maxRuntimeMs: 3_600_000,
        disableModelCallLimit: true,
      },
    });

    await submitAgentRun({
      workspace: { id: 7, chatMode: "automatic" },
      thread: { id: 105 },
      user: { id: 2 },
      agentId: 9,
      prompt: "分析 KI#22",
      source: "workspace",
      configuration: { approvalMode: "always_allow" },
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          disableExecutionLimits: false,
          disableModelCallLimit: true,
          maxRuntimeMs: 3_600_000,
          maxModelCallsPerTask: null,
        }),
        policySnapshot: expect.objectContaining({
          disableExecutionLimits: false,
          disableModelCallLimit: true,
          maxRuntimeMs: 3_600_000,
          maxTaskModelCalls: null,
        }),
      })
    );
  });
});

describe("context-compaction setting snapshots", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockImplementation(async (input) => ({ id: "run-1", ...input }));
  });
  it("honors an explicitly disabled system setting even when a caller asks to enable it", async () => {
    SystemSettings.agentContextCompactionEnabled.mockResolvedValueOnce(false);
    await submitAgentRun({
      workspace: { id: 7 },
      prompt: "test",
      configuration: { contextCompactionEnabled: true },
    });
    expect(
      mockCreate.mock.calls.at(-1)[0].configuration.contextCompactionEnabled
    ).toBe(false);
    expect(
      mockCreate.mock.calls.at(-1)[0].policySnapshot.contextCompactionEnabled
    ).toBe(false);
  });

  it("copies the saved setting into a new run independently of execution limits", async () => {
    SystemSettings.agentContextCompactionEnabled.mockResolvedValueOnce(true);
    SystemSettings.agentExecutionLimitsDisabled.mockResolvedValueOnce(true);
    await submitAgentRun({
      workspace: { id: 7 },
      prompt: "test",
      configuration: { contextCompactionEnabled: false },
    });
    expect(
      mockCreate.mock.calls.at(-1)[0].configuration.contextCompactionEnabled
    ).toBe(true);
    expect(
      mockCreate.mock.calls.at(-1)[0].policySnapshot.contextCompactionEnabled
    ).toBe(true);
  });
});
