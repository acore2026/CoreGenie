const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");
const { safeJsonParse } = require("../utils/http");

function normalizeExecution(row) {
  if (!row) return null;
  return {
    ...row,
    arguments: safeJsonParse(row.arguments, {}),
    result: safeJsonParse(row.result, row.result),
  };
}

const AgentToolExecution = {
  get: async function (runId, callId) {
    return normalizeExecution(
      await prisma.agent_tool_executions.findUnique({
        where: {
          run_id_call_id: {
            run_id: String(runId),
            call_id: String(callId),
          },
        },
      })
    );
  },

  begin: async function ({ runId, callId, parentId, toolId, agentId, args }) {
    return normalizeExecution(
      await prisma.agent_tool_executions.upsert({
        where: {
          run_id_call_id: {
            run_id: String(runId),
            call_id: String(callId),
          },
        },
        create: {
          id: uuidv4(),
          run_id: String(runId),
          call_id: String(callId),
          parent_id: parentId || null,
          tool_id: String(toolId),
          agent_id: agentId ? Number(agentId) : null,
          status: "running",
          arguments: JSON.stringify(args || {}),
          startedAt: new Date(),
        },
        update: {
          status: "running",
          error: null,
          lastUpdatedAt: new Date(),
        },
      })
    );
  },

  finish: async function (runId, callId, { result = null, error = null } = {}) {
    return normalizeExecution(
      await prisma.agent_tool_executions.update({
        where: {
          run_id_call_id: { run_id: String(runId), call_id: String(callId) },
        },
        data: {
          status: error ? "failed" : "completed",
          result: result === null ? null : JSON.stringify(result),
          error,
          completedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      })
    );
  },
};

module.exports = { AgentToolExecution, normalizeExecution };
