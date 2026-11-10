/* eslint-env jest, node */
jest.mock("../../models/agentRun", () => ({
  AgentRun: {
    isTerminal: (status) =>
      ["completed", "partial", "failed", "cancelled"].includes(status),
    get: jest.fn(),
    update: jest.fn(),
    claim: jest.fn(),
    heartbeat: jest.fn(),
    releaseLease: jest.fn(),
  },
}));
jest.mock("../../models/agentRunEvent", () => ({
  AgentRunEvent: { append: jest.fn() },
}));
jest.mock("../../models/agentRunTask", () => ({
  AgentRunTask: { reconcileTerminal: jest.fn() },
}));
jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: { reconcileActive: jest.fn() },
}));
jest.mock("../../agent-system/executor", () => ({
  executeAgentRun: jest.fn(),
  persistFailedAgentRun: jest.fn(),
}));
jest.mock("../../agent-system/observability", () => ({
  flushLangfuse: jest.fn().mockResolvedValue(null),
}));
jest.mock("../../agent-system/checkpointer", () => ({
  deleteCheckpointThread: jest.fn().mockResolvedValue(null),
}));

const { AgentRun } = require("../../models/agentRun");
const { AgentRunEvent } = require("../../models/agentRunEvent");
const { AgentRunTask } = require("../../models/agentRunTask");
const { AgentToolExecution } = require("../../models/agentToolExecution");
const {
  executeAgentRun,
  persistFailedAgentRun,
} = require("../../agent-system/executor");
const { AgentRunSupervisor } = require("../../agent-system/supervisor");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("AgentRunSupervisor cancellation", () => {
  let run, supervisor;
  beforeEach(() => {
    jest.clearAllMocks();
    run = {
      id: "run-1",
      status: "running",
      checkpointThreadId: "cp-1",
      configuration: {},
    };
    supervisor = new AgentRunSupervisor({ concurrency: 1 });
    AgentRun.get.mockImplementation(async () => ({ ...run }));
    AgentRun.claim.mockImplementation(async () => ({ ...run }));
    AgentRun.update.mockImplementation(
      async (_, data) => (run = { ...run, ...data })
    );
    AgentRun.releaseLease.mockResolvedValue(null);
    AgentRun.heartbeat.mockResolvedValue(true);
    AgentRunEvent.append.mockResolvedValue(null);
    AgentRunTask.reconcileTerminal.mockResolvedValue(null);
    AgentToolExecution.reconcileActive.mockResolvedValue(null);
    persistFailedAgentRun.mockImplementation(async () => {
      run = {
        ...run,
        status: "cancelled",
        finalResponse: "已下载部分资料。\n\n任务已停止。",
      };
      return {
        run,
        chatId: 42,
        partial: true,
        responseText: run.finalResponse,
        streamDelta: { delta: "\n\n任务已停止。" },
        messageParts: [],
      };
    });
  });

  it.each(["running", "queued", "waiting_for_input", "waiting_for_approval"])(
    "saves the reply without a local worker (%s)",
    async (status) => {
      run.status = status;
      run.leaseOwner = "old-container:184";
      await expect(supervisor.cancel(run.id)).resolves.toBe(true);
      expect(persistFailedAgentRun).toHaveBeenCalledWith(
        run.id,
        expect.any(Error),
        { cancelled: true }
      );
      expect(AgentRunEvent.append.mock.calls.map(([, type]) => type)).toEqual([
        "message.delta",
        "message.completed",
        "run.cancelled",
      ]);
      expect(AgentRunEvent.append).toHaveBeenCalledWith(
        run.id,
        "run.cancelled",
        {
          status: "cancelled",
          chatId: 42,
          sources: [],
        }
      );
      expect(AgentToolExecution.reconcileActive).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({ status: "cancelled" })
      );
    }
  );

  it.each(["reject", "resolve"])(
    "does not wait for a stuck worker or resave when it later %ss",
    async (outcome) => {
      const started = deferred();
      const worker = deferred();
      let signal;
      executeAgentRun.mockImplementation((_, workerSignal) => {
        signal = workerSignal;
        started.resolve();
        return worker.promise;
      });
      supervisor.enqueue(run.id);
      await started.promise;
      await expect(supervisor.cancel(run.id)).resolves.toBe(true);
      expect(signal.aborted).toBe(true);
      expect(run.status).toBe("cancelled");
      if (outcome === "reject") worker.reject(new Error("late abort"));
      else worker.resolve();
      await supervisor.queue.onIdle();
      expect(persistFailedAgentRun).toHaveBeenCalledTimes(1);
      expect(
        AgentRunEvent.append.mock.calls.filter(
          ([, type]) => type === "run.cancelled"
        )
      ).toHaveLength(1);
    }
  );

  it("shares concurrent cancellation requests and ignores later repeats", async () => {
    await expect(
      Promise.all([supervisor.cancel(run.id), supervisor.cancel(run.id)])
    ).resolves.toEqual([true, true]);
    await expect(supervisor.cancel(run.id)).resolves.toBe(false);
    expect(persistFailedAgentRun).toHaveBeenCalledTimes(1);
  });

  it("leaves the run cancellable if saving fails and allows retry", async () => {
    persistFailedAgentRun.mockRejectedValueOnce(
      new Error("database unavailable")
    );
    await expect(supervisor.cancel(run.id)).rejects.toThrow(
      "database unavailable"
    );
    expect(run.status).toBe("running");
    expect(AgentRunEvent.append).not.toHaveBeenCalled();
    await expect(supervisor.cancel(run.id)).resolves.toBe(true);
  });

  it("does not publish a cancellation if another worker finished first", async () => {
    persistFailedAgentRun.mockResolvedValueOnce(null);
    await expect(supervisor.cancel(run.id)).resolves.toBe(false);
    expect(AgentRunEvent.append).not.toHaveBeenCalled();
  });

  it("does not change an already completed run", async () => {
    run.status = "completed";
    await expect(supervisor.cancel(run.id)).resolves.toBe(false);
    expect(persistFailedAgentRun).not.toHaveBeenCalled();
  });
});
