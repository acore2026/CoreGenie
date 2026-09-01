const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const { v4: uuidv4 } = require("uuid");
const { withPrismaRetry } = require("../utils/prismaRetry");

function normalizeCommand(row) {
  if (!row) return null;
  return {
    ...row,
    payload: safeJsonParse(row.payload, {}),
    result: safeJsonParse(row.result, row.result),
  };
}

const AgentRunCommand = {
  create: async function ({
    id = uuidv4(),
    runId,
    taskId = null,
    type,
    payload,
  }) {
    return normalizeCommand(
      await withPrismaRetry(() =>
        prisma.agent_run_commands.upsert({
          where: { id: String(id) },
          create: {
            id: String(id),
            run_id: String(runId),
            task_id: taskId || null,
            type: String(type),
            payload: JSON.stringify(payload || {}),
          },
          update: {},
        })
      )
    );
  },

  complete: async function (id, result = {}) {
    return normalizeCommand(
      await withPrismaRetry(() =>
        prisma.agent_run_commands.update({
          where: { id: String(id) },
          data: {
            status: "completed",
            result: JSON.stringify(result || {}),
            completedAt: new Date(),
          },
        })
      )
    );
  },
};

module.exports = { AgentRunCommand, normalizeCommand };
