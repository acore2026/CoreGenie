const PQueue = require("p-queue").default;
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const { AgentRun } = require("../models/agentRun");
const { AgentRunEvent } = require("../models/agentRunEvent");
const { AgentRunTask } = require("../models/agentRunTask");
const { AgentToolExecution } = require("../models/agentToolExecution");
const { executeAgentRun, persistFailedAgentRun } = require("./executor");
const { flushLangfuse } = require("./observability");
const { deleteCheckpointThread } = require("./checkpointer");

class AgentRunSupervisor {
  constructor({ concurrency = 4 } = {}) {
    this.queue = new PQueue({ concurrency });
    this.controllers = new Map();
    this.scheduled = new Set();
    this.started = false;
    this.owner = `${os.hostname()}:${process.pid}:${uuidv4()}`;
    // Tool/model calls can synchronously prepare large visual payloads and delay
    // the event loop long enough to miss several heartbeats. Keep a generous
    // reclaim window so an otherwise healthy run is not executed twice.
    this.leaseMs = 5 * 60_000;
    this.poller = null;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await AgentToolExecution.reconcileTerminalRuns().catch((error) =>
      console.error(
        `[AgentRunSupervisor] Failed to reconcile terminal tool calls: ${error.message}`
      )
    );
    for (const run of await AgentRun.reclaimable(100)) this.enqueue(run.id);
    this.poller = setInterval(async () => {
      for (const run of await AgentRun.reclaimable(100)) this.enqueue(run.id);
    }, 5_000);
    this.poller.unref?.();
  }

  enqueue(runId) {
    const id = String(runId);
    if (this.scheduled.has(id)) return;
    this.scheduled.add(id);
    this.queue.add(async () => {
      let claimed = await AgentRun.claim(id, this.owner, this.leaseMs);
      if (!claimed) {
        this.scheduled.delete(id);
        return;
      }
      if (claimed.status === "running") {
        await AgentToolExecution.reconcileActive(id, {
          error:
            "This tool call was interrupted when the Agent worker restarted; the run resumed from its checkpoint.",
          outcomeCode: "WORKER_RESTARTED",
        }).catch(() => null);
        claimed = await AgentRun.update(id, {
          status: "queued",
          configuration: { ...claimed.configuration, recover: true },
        });
      }
      const controller = new AbortController();
      let timedOut = false;
      const maxRuntimeMs = Math.min(
        Math.max(
          Number(claimed.configuration?.maxRuntimeMs) || 60 * 60 * 1_000,
          60_000
        ),
        300 * 60 * 1_000
      );
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("Agent run time budget exhausted."));
      }, maxRuntimeMs);
      timeout.unref?.();
      this.controllers.set(id, controller);
      const heartbeat = setInterval(
        () =>
          AgentRun.heartbeat(id, this.owner, this.leaseMs).catch(() => null),
        10_000
      );
      heartbeat.unref?.();
      try {
        await executeAgentRun(id, controller.signal);
      } catch (error) {
        const latest = await AgentRun.get(id);
        if (AgentRun.isTerminal(latest?.status)) return;
        const cancelled = controller.signal.aborted && !timedOut;
        const persisted = cancelled
          ? null
          : await persistFailedAgentRun(id, error).catch(() => null);
        const partial = Boolean(persisted?.partial);
        if (persisted?.responseText) {
          await AgentRunEvent.append(id, "message.delta", {
            messageId: `${id}:assistant`,
            delta: persisted.responseText,
          }).catch(() => null);
          await AgentRunEvent.append(id, "message.completed", {
            messageId: `${id}:assistant`,
            text: persisted.responseText,
            chatId: persisted.chatId,
          }).catch(() => null);
        }
        await AgentRun.update(id, {
          status: cancelled ? "cancelled" : partial ? "partial" : "failed",
          phase: "complete",
          terminationReason: cancelled
            ? "cancelled_by_user"
            : timedOut
              ? "run_time_budget_exhausted"
              : partial
                ? "partial_results_after_error"
                : "runtime_error",
          error: error.message,
          finalResponse: persisted?.responseText || null,
          completedAt: new Date(),
        }).catch(() => null);
        await AgentToolExecution.reconcileActive(id, {
          status: cancelled ? "cancelled" : "failed",
          error: cancelled
            ? "The run was cancelled before this tool call completed."
            : `The run ended before this tool call completed: ${error.message}`,
          outcomeCode: cancelled ? "RUN_CANCELLED" : "RUN_FAILED",
        }).catch(() => null);
        await AgentRunTask.reconcileTerminal(
          id,
          cancelled ? "cancelled" : partial ? "cancelled" : "failed"
        ).catch(() => null);
        await AgentRunEvent.append(
          id,
          cancelled ? "run.cancelled" : partial ? "run.partial" : "run.failed",
          {
            status: cancelled ? "cancelled" : partial ? "partial" : "failed",
            error: error.message,
            chatId: persisted?.chatId || null,
            sources: [],
          }
        ).catch(() => null);
        await deleteCheckpointThread(latest?.checkpointThreadId).catch(
          () => null
        );
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        this.controllers.delete(id);
        this.scheduled.delete(id);
        await AgentRun.releaseLease(id, this.owner).catch(() => null);
        await flushLangfuse();
      }
    });
  }

  async cancel(runId) {
    const id = String(runId);
    const run = await AgentRun.get(id);
    if (!run || AgentRun.isTerminal(run.status)) return false;
    this.controllers.get(id)?.abort();
    await AgentRun.update(id, {
      status: "cancelled",
      phase: "complete",
      terminationReason: "cancelled_by_user",
      error: "Cancelled by user.",
      completedAt: new Date(),
    });
    await Promise.allSettled([
      AgentToolExecution.reconcileActive(id, {
        error: "The run was cancelled before this tool call completed.",
        outcomeCode: "RUN_CANCELLED",
      }),
      AgentRunTask.reconcileTerminal(id, "cancelled"),
    ]);
    await AgentRunEvent.append(id, "run.cancelled", { status: "cancelled" });
    await deleteCheckpointThread(run.checkpointThreadId);
    return true;
  }
}

const agentRunSupervisor = new AgentRunSupervisor({
  concurrency: Number(process.env.AGENT_RUN_CONCURRENCY) || 4,
});

module.exports = { AgentRunSupervisor, agentRunSupervisor };
