const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const { agentRunEventBus } = require("../agent-system/eventBus");
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
        const row = await prisma.$transaction(async (tx) => {
          const aggregate = await tx.agent_run_events.aggregate({
            where: { run_id: id },
            _max: { sequence: true },
          });
          return tx.agent_run_events.create({
            data: {
              run_id: id,
              sequence: (aggregate._max.sequence || 0) + 1,
              version: 1,
              type: String(type),
              payload: JSON.stringify(payload || {}),
            },
          });
        });
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
};

module.exports = { AgentRunEvent, normalizeEvent };
