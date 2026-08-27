const PQueue = require("p-queue").default;
const prisma = require("../utils/prisma");
const { AgentRun } = require("../models/agentRun");
const { AgentRunEvent } = require("../models/agentRunEvent");
const { executeAgentRun } = require("./executor");
const { flushLangfuse } = require("./observability");

class AgentRunSupervisor {
  constructor({ concurrency = 4 } = {}) {
    this.queue = new PQueue({ concurrency });
    this.controllers = new Map();
    this.scheduled = new Set();
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    const interrupted = await prisma.agent_runs.findMany({
      where: { status: "running" },
    });
    for (const record of interrupted) {
      const run = await AgentRun.get(record.id);
      await AgentRun.update(record.id, {
        status: "queued",
        configuration: { ...run.configuration, recover: true },
      });
    }
    for (const run of await AgentRun.queued(100)) this.enqueue(run.id);
  }

  enqueue(runId) {
    const id = String(runId);
    if (this.scheduled.has(id)) return;
    this.scheduled.add(id);
    this.queue.add(async () => {
      const controller = new AbortController();
      this.controllers.set(id, controller);
      try {
        await executeAgentRun(id, controller.signal);
      } catch (error) {
        const latest = await AgentRun.get(id);
        if (AgentRun.isTerminal(latest?.status)) return;
        const cancelled = controller.signal.aborted;
        await AgentRun.update(id, {
          status: cancelled ? "cancelled" : "failed",
          error: error.message,
          completedAt: new Date(),
        }).catch(() => null);
        await AgentRunEvent.append(
          id,
          cancelled ? "run.cancelled" : "run.failed",
          {
            status: cancelled ? "cancelled" : "failed",
            error: error.message,
          }
        ).catch(() => null);
      } finally {
        this.controllers.delete(id);
        this.scheduled.delete(id);
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
      error: "Cancelled by user.",
      completedAt: new Date(),
    });
    await AgentRunEvent.append(id, "run.cancelled", { status: "cancelled" });
    return true;
  }
}

const agentRunSupervisor = new AgentRunSupervisor({
  concurrency: Number(process.env.AGENT_RUN_CONCURRENCY) || 4,
});

module.exports = { AgentRunSupervisor, agentRunSupervisor };
