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
const { executionLimitsDisabled } = require("./executionLimits");

// 把失败/取消运行已生成的回复补写进事件流，让前端把聊天记录 ID 关联到消息上。
async function appendPersistedMessage(id, persisted) {
  if (!persisted?.responseText) return;
  await AgentRunEvent.append(id, "message.delta", {
    messageId: `${id}:assistant`,
    ...(persisted.streamDelta || { delta: persisted.responseText }),
  }).catch(() => null);
  await AgentRunEvent.append(id, "message.completed", {
    messageId: `${id}:assistant`,
    text: persisted.responseText,
    chatId: persisted.chatId,
    outputs: persisted.outputs || [],
    ...(persisted.messageParts ? { parts: persisted.messageParts } : {}),
  }).catch(() => null);
}

class AgentRunSupervisor {
  constructor({ concurrency = 8 } = {}) {
    this.queue = new PQueue({ concurrency });
    this.controllers = new Map();
    this.cancellations = new Map();
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
    this.queue
      .add(async () => {
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
          claimed = await AgentRun.update(
            id,
            {
              status: "queued",
              configuration: { ...claimed.configuration, recover: true },
            },
            { onlyActive: true }
          );
          if (!claimed || AgentRun.isTerminal(claimed.status)) {
            this.scheduled.delete(id);
            await AgentRun.releaseLease(id, this.owner);
            return;
          }
        }
        const controller = new AbortController();
        let timedOut = false;
        const timeout = executionLimitsDisabled(claimed)
          ? null
          : setTimeout(
              () => {
                timedOut = true;
                controller.abort(new Error("Agent run time budget exhausted."));
              },
              Math.min(
                Math.max(
                  Number(claimed.configuration?.maxRuntimeMs) ||
                    4 * 60 * 60 * 1_000,
                  60_000
                ),
                24 * 60 * 60 * 1_000
              )
            );
        timeout?.unref?.();
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
          const persisted = await persistFailedAgentRun(id, error, {
            cancelled,
            timedOut,
          });
          if (!persisted) return;
          const partial = Boolean(persisted?.partial);
          await appendPersistedMessage(id, persisted);
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
            cancelled
              ? "run.cancelled"
              : partial
                ? "run.partial"
                : "run.failed",
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
      })
      .catch((error) =>
        console.error(`[AgentRunSupervisor] ${id}: ${error.message}`)
      );
  }

  async cancel(runId) {
    const id = String(runId);
    if (this.cancellations.has(id)) return this.cancellations.get(id);
    const pending = this.cancelAndPersist(id);
    this.cancellations.set(id, pending);
    try {
      return await pending;
    } finally {
      this.cancellations.delete(id);
    }
  }

  async cancelAndPersist(id) {
    const run = await AgentRun.get(id);
    if (!run || AgentRun.isTerminal(run.status)) return false;
    // Persist from durable events even when the worker belongs to an old
    // container or ignores abort. Chat + cancelled state commit together.
    const persisted = await persistFailedAgentRun(
      id,
      new Error("Cancelled by user."),
      { cancelled: true }
    );
    if (!persisted) return false;
    this.controllers.get(id)?.abort();
    await appendPersistedMessage(id, persisted);
    await Promise.allSettled([
      AgentToolExecution.reconcileActive(id, {
        status: "cancelled",
        error: "The run was cancelled before this tool call completed.",
        outcomeCode: "RUN_CANCELLED",
      }),
      AgentRunTask.reconcileTerminal(id, "cancelled"),
    ]);
    await AgentRunEvent.append(id, "run.cancelled", {
      status: "cancelled",
      chatId: persisted.chatId,
      sources: [],
    });
    await AgentRun.releaseLease(id);
    await deleteCheckpointThread(run.checkpointThreadId);
    return true;
  }
}

const agentRunSupervisor = new AgentRunSupervisor({
  concurrency: Number(process.env.AGENT_RUN_CONCURRENCY) || 8,
});

module.exports = { AgentRunSupervisor, agentRunSupervisor };
