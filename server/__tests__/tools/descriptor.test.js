/* eslint-env jest, node */
jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: {
    get: jest.fn().mockResolvedValue(null),
    findOperation: jest.fn().mockResolvedValue([]),
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

  it("reuses a successful read and stops after repeated calls add no new result", async () => {
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
    const second = JSON.parse(
      await wrapped.func({ value: "same" }, undefined, {
        toolCall: { id: "call-2" },
      })
    );
    for (const callId of ["call-3", "call-4", "call-5"])
      await wrapped.func({ value: "same" }, undefined, {
        toolCall: { id: callId },
      });

    await expect(
      wrapped.func({ value: "same" }, undefined, {
        toolCall: { id: "call-6" },
      })
    ).rejects.toMatchObject({ code: "TASK_NO_PROGRESS", retryable: false });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      ok: true,
      code: "RESULT_REUSED",
      reused: true,
    });
    expect(AgentToolExecution.finish).toHaveBeenLastCalledWith(
      "run-1",
      "call-6",
      expect.objectContaining({
        status: "skipped",
        outcomeCode: "RESULT_REUSED",
      })
    );
    expect(emit).toHaveBeenCalledWith(
      "tool.skipped",
      expect.objectContaining({ callId: "call-6", code: "RESULT_REUSED" })
    );
  });

  it("retries an identical read only after a retryable failure", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: "HTTP_503",
        summary: "Temporary failure",
        retryable: true,
      })
      .mockResolvedValueOnce("usable result");
    const wrapped = toLangChainTool(
      defineTool({
        id: "read.retryable",
        description: "Read a retryable value",
        schema: z.object({ value: z.string() }),
        execute,
        action: false,
      }),
      context()
    );

    await wrapped.func({ value: "same" }, undefined, {
      toolCall: { id: "call-1" },
    });
    const second = JSON.parse(
      await wrapped.func({ value: "same" }, undefined, {
        toolCall: { id: "call-2" },
      })
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ ok: true, code: "OK" });
  });

  it("executes concurrent identical reads only once", async () => {
    let finishRead;
    const execute = jest.fn(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve("usable result");
        })
    );
    const wrapped = toLangChainTool(
      defineTool({
        id: "read.concurrent",
        description: "Read a value once",
        schema: z.object({ value: z.string() }),
        execute,
        action: false,
      }),
      context()
    );

    const first = wrapped.func({ value: "same" }, undefined, {
      toolCall: { id: "call-1" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const second = wrapped.func({ value: "same" }, undefined, {
      toolCall: { id: "call-2" },
    });
    finishRead();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(JSON.parse(firstResult)).toMatchObject({ ok: true, code: "OK" });
    expect(JSON.parse(secondResult)).toMatchObject({
      ok: true,
      code: "RESULT_REUSED",
      reused: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not retry an identical read after a non-retryable failure", async () => {
    const execute = jest.fn().mockResolvedValue({
      ok: false,
      code: "NOT_FOUND",
      summary: "Missing",
      retryable: false,
    });
    const wrapped = toLangChainTool(
      defineTool({
        id: "read.missing",
        description: "Read a missing value",
        schema: z.object({ value: z.string() }),
        execute,
        action: false,
      }),
      context()
    );

    await wrapped.func({ value: "same" }, undefined, {
      toolCall: { id: "call-1" },
    });
    const second = JSON.parse(
      await wrapped.func({ value: "same" }, undefined, {
        toolCall: { id: "call-2" },
      })
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ ok: false, code: "NO_PROGRESS" });
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

  it("blocks related failed operations until their recovery request succeeds", async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const execute = jest.fn().mockImplementation(async ({ value }) =>
      value === "parent"
        ? "official directory listing"
        : {
            ok: false,
            code: "HTTP_403",
            summary: "HTTP 403 Forbidden",
            retryable: false,
            countsTowardFailureFamily: true,
          }
    );
    const wrapped = toLangChainTool(
      defineTool({
        id: "read.family",
        description: "Read related test values",
        schema: z.object({ value: z.string() }),
        execute,
        action: false,
        failureFamily: ({ value }) => ({
          key: "example-family",
          recovery: value === "parent",
          blockedSummary: "Open the parent first.",
        }),
      }),
      context(emit)
    );

    await wrapped.func({ value: "wrong-a" }, undefined, {
      toolCall: { id: "call-1" },
    });
    await wrapped.func({ value: "wrong-b" }, undefined, {
      toolCall: { id: "call-2" },
    });
    const blocked = JSON.parse(
      await wrapped.func({ value: "wrong-c" }, undefined, {
        toolCall: { id: "call-3" },
      })
    );
    await wrapped.func({ value: "parent" }, undefined, {
      toolCall: { id: "call-4" },
    });
    await wrapped.func({ value: "correct-child" }, undefined, {
      toolCall: { id: "call-5" },
    });

    expect(blocked).toMatchObject({ ok: false, code: "NO_PROGRESS" });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.at(-1)[0]).toEqual({ value: "correct-child" });
  });
});
