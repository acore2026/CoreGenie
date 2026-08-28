const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const { agentRunEventBus } = require("../agent-system/eventBus");
const { withPrismaRetry } = require("../utils/prismaRetry");
const appendQueues = new Map();

function normalizeEvent(event) {
  if (!event) return null;
  return {
    id: event.sequence,
    runId: event.run_id,
    version: event.version,
    type: event.type,
    payload: safeJsonParse(event.payload, {}),
    createdAt: event.createdAt,
  };
}

const AgentRunEvent = {
  append: async function (runId, type, payload = {}) {
    const id = String(runId);
    const previous = appendQueues.get(id) || Promise.resolve();
    const pending = previous
      .catch(() => null)
      .then(async () => {
        const row = await withPrismaRetry(() =>
          prisma.$transaction(async (tx) => {
            const run = await tx.agent_runs.update({
              where: { id },
              data: { nextEventSequence: { increment: 1 } },
              select: { nextEventSequence: true },
            });
            return tx.agent_run_events.create({
              data: {
                run_id: id,
                sequence: run.nextEventSequence,
                version: 2,
                type: String(type),
                payload: JSON.stringify(payload || {}),
              },
            });
          })
        );
        const event = normalizeEvent(row);
        agentRunEventBus.publish(event);
        return event;
      });
    appendQueues.set(id, pending);
    pending.then(
      () => {
        if (appendQueues.get(id) === pending) appendQueues.delete(id);
      },
      () => {
        if (appendQueues.get(id) === pending) appendQueues.delete(id);
      }
    );
    return pending;
  },

  after: async function (runId, sequence = 0, take = 1_000) {
    const rows = await prisma.agent_run_events.findMany({
      where: {
        run_id: String(runId),
        sequence: { gt: Number(sequence) || 0 },
      },
      orderBy: { sequence: "asc" },
      take,
    });
    return rows.map(normalizeEvent);
  },

  traceSnapshot: async function (runId) {
    const resourceTypes = [
      "context.memory.recalled",
      "context.memory.updated",
      "context.rag.recalled",
      "skill.activated",
      "skill.updated",
      "skill.resource.used",
      "skill.script.executed",
    ];
    const [activities, resources] = await Promise.all([
      prisma.agent_run_events.findMany({
        where: { run_id: String(runId), type: "activity.updated" },
        orderBy: { sequence: "desc" },
        take: 24,
      }),
      prisma.agent_run_events.findMany({
        where: { run_id: String(runId), type: { in: resourceTypes } },
        orderBy: { sequence: "desc" },
        take: 48,
      }),
    ]);
    return [...activities, ...resources]
      .sort((left, right) => left.sequence - right.sequence)
      .map(normalizeEvent);
  },

  latestSequence: async function (runId) {
    const run = await prisma.agent_runs.findUnique({
      where: { id: String(runId) },
      select: { nextEventSequence: true },
    });
    return run?.nextEventSequence || 0;
  },
};

module.exports = { AgentRunEvent, normalizeEvent };
