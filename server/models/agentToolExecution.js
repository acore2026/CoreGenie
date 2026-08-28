const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");
const { safeJsonParse } = require("../utils/http");
const { withPrismaRetry } = require("../utils/prismaRetry");

const ACTIVE_STATUSES = ["requested", "running", "started", "retrying"];
const TERMINAL_RUN_STATUSES = ["completed", "partial", "failed", "cancelled"];

function normalizeExecution(row) {
  if (!row) return null;
  return {
    ...row,
    arguments: safeJsonParse(row.arguments, {}),
    result: safeJsonParse(row.result, row.result),
    artifactIds: safeJsonParse(row.artifact_ids, []),
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

  begin: async function ({
    runId,
    callId,
    parentId,
    taskId = null,
    toolId,
    agentId,
    args,
    operationKey = null,
    attempt = 1,
  }) {
    return normalizeExecution(
      await withPrismaRetry(() =>
        prisma.agent_tool_executions.upsert({
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
            task_id: taskId || null,
            tool_id: String(toolId),
            agent_id: agentId ? Number(agentId) : null,
            status: "running",
            arguments: JSON.stringify(args || {}),
            operation_key: operationKey,
            attempt: Number(attempt) || 1,
            startedAt: new Date(),
          },
          update: {
            status: "running",
            error: null,
            lastUpdatedAt: new Date(),
          },
        })
      )
    );
  },

  finish: async function (
    runId,
    callId,
    {
      result = null,
      error = null,
      outcomeCode = null,
      retryable = false,
      resultSummary = null,
      artifactIds = [],
      status = null,
    } = {}
  ) {
    return normalizeExecution(
      await withPrismaRetry(() =>
        prisma.agent_tool_executions.update({
          where: {
            run_id_call_id: { run_id: String(runId), call_id: String(callId) },
          },
          data: {
            status: status || (error ? "failed" : "completed"),
            result: result === null ? null : JSON.stringify(result),
            error,
            outcome_code: outcomeCode,
            retryable: Boolean(retryable),
            result_summary: resultSummary,
            artifact_ids: JSON.stringify(artifactIds || []),
            completedAt: new Date(),
            lastUpdatedAt: new Date(),
          },
        })
      )
    );
  },

  findOperation: async function (runId, taskId, operationKey) {
    if (!operationKey) return [];
    const rows = await prisma.agent_tool_executions.findMany({
      where: {
        run_id: String(runId),
        task_id: taskId || null,
        operation_key: String(operationKey),
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(normalizeExecution);
  },

  listForTask: async function (runId, taskId) {
    const rows = await prisma.agent_tool_executions.findMany({
      where: {
        run_id: String(runId),
        task_id: String(taskId),
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(normalizeExecution);
  },

  completedToolIds: async function (runId) {
    const rows = await prisma.agent_tool_executions.findMany({
      where: { run_id: String(runId), status: "completed" },
      select: { tool_id: true },
      distinct: ["tool_id"],
    });
    return rows.map((row) => row.tool_id);
  },

  reconcileActive: async function (
    runId,
    {
      status = "cancelled",
      error = "The run ended before this tool call completed.",
      outcomeCode = "RUN_ENDED_WITHOUT_TOOL_RESULT",
    } = {}
  ) {
    return withPrismaRetry(() =>
      prisma.agent_tool_executions.updateMany({
        where: {
          run_id: String(runId),
          status: { in: ACTIVE_STATUSES },
        },
        data: {
          status,
          error,
          outcome_code: outcomeCode,
          retryable: false,
          completedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      })
    );
  },

  reconcileTerminalRuns: async function () {
    const terminalRuns = await prisma.agent_runs.findMany({
      where: { status: { in: TERMINAL_RUN_STATUSES } },
      select: { id: true },
    });
    if (!terminalRuns.length) return { count: 0 };
    return withPrismaRetry(() =>
      prisma.agent_tool_executions.updateMany({
        where: {
          run_id: { in: terminalRuns.map(({ id }) => id) },
          status: { in: ACTIVE_STATUSES },
        },
        data: {
          status: "cancelled",
          error: "The run ended before this tool call completed.",
          outcome_code: "RUN_ENDED_WITHOUT_TOOL_RESULT",
          retryable: false,
          completedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      })
    );
  },
};

module.exports = {
  ACTIVE_STATUSES,
  AgentToolExecution,
  normalizeExecution,
};
