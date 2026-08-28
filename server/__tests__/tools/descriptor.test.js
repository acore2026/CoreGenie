/* eslint-env jest, node */
jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: {
    get: jest.fn().mockResolvedValue(null),
    begin: jest.fn().mockResolvedValue({}),
    finish: jest.fn().mockResolvedValue({}),
  },
}));

const { z } = require("zod");
const { AgentToolExecution } = require("../../models/agentToolExecution");
const { AgentToolContext } = require("../../tools/context");
const { defineTool, toLangChainTool } = require("../../tools/descriptor");

function context(emit = jest.fn().mockResolvedValue(undefined)) {
  return new AgentToolContext({
    run: { id: "run-1", configuration: {} },
    workspace: { id: 1 },
    agent: { id: 1 },
    emit,
    signal: new AbortController().signal,
  });
}

describe("governed tool execution policy", () => {
  beforeEach(() => jest.clearAllMocks());

  it("records a third identical operation as skipped, not failed", async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const execute = jest.fn().mockResolvedValue("usable result");
    const wrapped = toLangChainTool(
      defineTool({
        id: "read.test",
        description: "Read a test value",
        schema: z.object({ value: z.string() }),
        execute,
        action: false,
      }),
      context(emit)
    );

    await wrapped.func({ value: "same" }, undefined, {
      toolCall: { id: "call-1" },
    });
    await wrapped.func({ value: "same" }, undefined, {
      toolCall: { id: "call-2" },
    });
    const third = JSON.parse(
      await wrapped.func({ value: "same" }, undefined, {
        toolCall: { id: "call-3" },
      })
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(third).toMatchObject({ ok: false, code: "NO_PROGRESS" });
    expect(AgentToolExecution.finish).toHaveBeenLastCalledWith(
      "run-1",
      "call-3",
      expect.objectContaining({ status: "skipped", outcomeCode: "NO_PROGRESS" })
    );
    expect(emit).toHaveBeenCalledWith(
      "tool.skipped",
      expect.objectContaining({ callId: "call-3", code: "NO_PROGRESS" })
    );
  });

  it("blocks a failed capability without executing more variants", async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const execute = jest.fn().mockResolvedValue({
      ok: false,
      code: "SANDBOX_UNAVAILABLE",
      summary: "Sandbox runtime is unavailable.",
      retryable: false,
      blocksCapability: true,
    });
    const wrapped = toLangChainTool(
      defineTool({
        id: "python",
        description: "Run Python",
        schema: z.object({ code: z.string() }),
        execute,
        failureScope: "Sandbox runtime",
      }),
      context(emit)
    );

    const first = JSON.parse(
      await wrapped.func({ code: "first" }, undefined, {
        toolCall: { id: "call-1" },
      })
    );
    const second = JSON.parse(
      await wrapped.func({ code: "changed" }, undefined, {
        toolCall: { id: "call-2" },
      })
    );

    expect(first.code).toBe("SANDBOX_UNAVAILABLE");
    expect(second.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      "tool.failed",
      expect.objectContaining({ code: "SANDBOX_UNAVAILABLE" })
    );
    expect(emit).toHaveBeenCalledWith(
      "tool.skipped",
      expect.objectContaining({ code: "CAPABILITY_UNAVAILABLE" })
    );
  });
});
