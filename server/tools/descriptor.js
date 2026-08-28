const { tool } = require("@langchain/core/tools");
const { v4: uuidv4 } = require("uuid");
const { AgentToolExecution } = require("../models/agentToolExecution");
const { isGraphBubbleUp } = require("@langchain/langgraph");
const crypto = require("crypto");

const DEFAULT_RESULT_BYTES = 32 * 1024;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function operationKey(descriptor, args) {
  return crypto
    .createHash("sha256")
    .update(`${descriptor.id}\0${JSON.stringify(stableValue(args || {}))}`)
    .digest("hex");
}

function normalizeToolResult(result) {
  if (
    result &&
    typeof result === "object" &&
    typeof result.ok === "boolean" &&
    result.code &&
    result.summary
  )
    return result;
  const serialized =
    typeof result === "string" ? result : JSON.stringify(result);
  return {
    ok: true,
    code: "OK",
    summary: String(serialized || "Tool completed successfully.").slice(0, 500),
    data: result,
    evidenceIds: [],
    artifactIds: [],
    retryable: false,
  };
}

function activitySummary(descriptor, args) {
  if (typeof descriptor.activity === "function")
    return String(descriptor.activity(args)).replace(/\s+/g, " ").slice(0, 180);
  if (typeof descriptor.activity === "string") return descriptor.activity;
  const detail = Object.values(args || {}).find(
    (value) => typeof value === "string" && value.trim()
  );
  return `${descriptor.description}${detail ? `: ${detail}` : ""}`
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function defineTool({
  id,
  name = id,
  description,
  schema,
  execute,
  action = true,
  effect = action ? "write" : "read",
  idempotency = action ? "none" : "safe",
  retry = null,
  maxResultBytes = DEFAULT_RESULT_BYTES,
  concurrencyKey = null,
  capabilities = [],
  activity = null,
  failureScope = null,
  failureFamily = null,
  maxFailureFamilyAttempts = 2,
}) {
  if (!id || !description || !schema || typeof execute !== "function")
    throw new Error(
      "Tool descriptors require id, description, schema, and execute."
    );
  if (!["read", "write", "destructive"].includes(effect))
    throw new Error(`Invalid effect for tool "${id}".`);
  if (!["safe", "keyed", "none"].includes(idempotency))
    throw new Error(`Invalid idempotency for tool "${id}".`);
  return Object.freeze({
    id,
    name,
    description,
    schema,
    execute,
    action,
    effect,
    idempotency,
    retry: retry || { maxAttempts: effect === "read" ? 2 : 1 },
    maxResultBytes,
    concurrencyKey,
    capabilities,
    activity,
    failureScope,
    failureFamily,
    maxFailureFamilyAttempts: Math.max(
      1,
      Number(maxFailureFamilyAttempts) || 2
    ),
  });
}

async function recordSkippedExecution({
  descriptor,
  context,
  callId,
  opKey,
  args,
  attempt,
  result,
}) {
  await AgentToolExecution.begin({
    runId: context.run.id,
    callId,
    taskId: context.taskId,
    toolId: descriptor.id,
    agentId: context.agent?.id,
    args,
    operationKey: opKey,
    attempt,
  });
  await AgentToolExecution.finish(context.run.id, callId, {
    result,
    outcomeCode: result.code,
    retryable: false,
    resultSummary: result.summary,
    status: "skipped",
  });
  await context.emit("tool.skipped", {
    callId,
    taskId: context.taskId,
    toolId: descriptor.id,
    operationKey: opKey,
    code: result.code,
    reason: result.summary,
    result,
  });
  return JSON.stringify(result);
}

async function skipWithoutProgress(options) {
  const serialized = await recordSkippedExecution(options);
  options.context.recordNoProgress(options.result);
  return serialized;
}

function reusableExecution(execution) {
  return (
    execution?.status === "completed" &&
    execution.result &&
    execution.result.ok !== false
  );
}

function reusableResult(execution) {
  const result = execution.result;
  return {
    ...result,
    code: "RESULT_REUSED",
    summary: `已复用这一步之前的成功结果，没有再次执行。${result.summary ? ` ${result.summary}` : ""}`,
    retryable: false,
    reused: true,
  };
}

function toLangChainTool(descriptor, context) {
  return tool(
    async (args, runnableConfig) => {
      const callId = runnableConfig?.toolCall?.id || uuidv4();
      const opKey = operationKey(descriptor, args);
      const existing = await AgentToolExecution.get(context.run.id, callId);
      if (existing?.status === "completed")
        return typeof existing.result === "string"
          ? existing.result
          : JSON.stringify(existing.result);
      return context.runOperation(opKey, async () => {
        context.consumeToolCall();
        const attempt = context.recordOperation(opKey);
        const durableExecutions = await AgentToolExecution.findOperation(
          context.run.id,
          context.taskId,
          opKey
        );
        const previousExecution =
          context.operationResult(opKey) || durableExecutions.at(-1) || null;
        if (
          descriptor.effect === "read" &&
          descriptor.idempotency === "safe" &&
          reusableExecution(previousExecution)
        ) {
          return skipWithoutProgress({
            descriptor,
            context,
            callId,
            opKey,
            args,
            attempt,
            result: reusableResult(previousExecution),
          });
        }
        if (
          descriptor.effect === "read" &&
          previousExecution &&
          !reusableExecution(previousExecution) &&
          previousExecution.retryable !== true
        ) {
          const blocked = {
            ok: false,
            code: "NO_PROGRESS",
            summary:
              "这一步之前已经失败，并且该错误不能通过原样重试解决。请换一种方式或根据现有资料完成任务。",
            retryable: false,
          };
          return skipWithoutProgress({
            descriptor,
            context,
            callId,
            opKey,
            args,
            attempt,
            result: blocked,
          });
        }
        const family =
          typeof descriptor.failureFamily === "function"
            ? descriptor.failureFamily(args)
            : null;
        const capabilityBlock = context.capabilityBlock?.(
          descriptor.failureScope
        );
        if (capabilityBlock) {
          const blocked = {
            ok: false,
            code: "CAPABILITY_UNAVAILABLE",
            summary: `${descriptor.failureScope} is unavailable for this run: ${capabilityBlock.summary}`,
            retryable: false,
          };
          return skipWithoutProgress({
            descriptor,
            context,
            callId,
            opKey,
            args,
            attempt,
            result: blocked,
          });
        }
        if (
          family?.key &&
          !family.recovery &&
          context.failureFamilyCount(family.key) >=
            descriptor.maxFailureFamilyAttempts
        ) {
          const blocked = {
            ok: false,
            code: "NO_PROGRESS",
            summary:
              family.blockedSummary ||
              "Related operations have already failed repeatedly. Use the documented recovery operation or finish with the available evidence.",
            retryable: false,
          };
          return skipWithoutProgress({
            descriptor,
            context,
            callId,
            opKey,
            args,
            attempt,
            result: blocked,
          });
        }
        if (attempt > 2) {
          const blocked = {
            ok: false,
            code: "NO_PROGRESS",
            summary:
              "This exact operation has already been attempted twice. Change the approach or finish with the available evidence.",
            retryable: false,
          };
          return skipWithoutProgress({
            descriptor,
            context,
            callId,
            opKey,
            args,
            attempt,
            result: blocked,
          });
        }
        await AgentToolExecution.begin({
          runId: context.run.id,
          callId,
          taskId: context.taskId,
          toolId: descriptor.id,
          agentId: context.agent?.id,
          args,
          operationKey: opKey,
          attempt,
        });
        const activity = activitySummary(descriptor, args);
        await context.emit("tool.started", {
          callId,
          taskId: context.taskId,
          toolId: descriptor.id,
          operationKey: opKey,
          summary: activity,
          arguments: args,
        });
        await context.emit("task.progress", {
          taskId: context.taskId,
          phase: "tool",
          summary: activity,
        });

        try {
          const execute = () =>
            descriptor.execute(args, context, runnableConfig);
          let rawResult;
          let executionError;
          const maxAttempts = Math.max(
            1,
            Number(descriptor.retry?.maxAttempts) || 1
          );
          for (
            let executionAttempt = 1;
            executionAttempt <= maxAttempts;
            executionAttempt += 1
          ) {
            try {
              rawResult = descriptor.action
                ? await context.runAction(execute)
                : await execute();
              executionError = null;
              break;
            } catch (error) {
              if (isGraphBubbleUp(error)) throw error;
              executionError = error;
              if (executionAttempt < maxAttempts) {
                await context.emit("tool.retrying", {
                  callId,
                  taskId: context.taskId,
                  toolId: descriptor.id,
                  operationKey: opKey,
                  attempt: executionAttempt + 1,
                  error: error.message,
                });
                await new Promise((resolve) =>
                  setTimeout(
                    resolve,
                    Math.min(250 * 2 ** (executionAttempt - 1), 1_000)
                  )
                );
              }
            }
          }
          if (executionError) throw executionError;
          const result = normalizeToolResult(rawResult);
          if (family?.key) {
            if (result.ok && family.recovery)
              context.clearFailureFamily(family.key);
            else if (!result.ok && result.countsTowardFailureFamily)
              context.recordFailureFamily(family.key);
          }
          const serialized = JSON.stringify(result);
          if (
            Buffer.byteLength(serialized, "utf8") > descriptor.maxResultBytes
          ) {
            result.data = String(serialized).slice(
              0,
              descriptor.maxResultBytes
            );
            if (result.ok) result.code = "OK_TRUNCATED";
            result.summary = `${result.summary} (Large result truncated for Agent context.)`;
          }
          const resultError = result.ok ? null : result.summary;
          await AgentToolExecution.finish(context.run.id, callId, {
            result,
            error: resultError,
            outcomeCode: result.code,
            retryable: result.retryable,
            resultSummary: result.summary,
            artifactIds: result.artifactIds,
          });
          if (result.blocksCapability && descriptor.failureScope)
            context.blockCapability?.(descriptor.failureScope, result);
          context.rememberOperationResult(opKey, {
            status: result.ok ? "completed" : "failed",
            result,
            retryable: result.retryable === true,
          });
          if (result.ok) context.recordProgress();
          await context.emit(result.ok ? "tool.completed" : "tool.failed", {
            callId,
            taskId: context.taskId,
            toolId: descriptor.id,
            operationKey: opKey,
            code: result.code,
            summary: result.summary,
            error: resultError,
            result,
          });
          await context.emit("task.progress", {
            taskId: context.taskId,
            phase: "reasoning",
            summary: context.taskTitle
              ? `Reviewing results for ${context.taskTitle}`
              : "Reviewing the latest result",
          });
          return JSON.stringify(result);
        } catch (error) {
          if (isGraphBubbleUp(error)) throw error;
          const failure = {
            ok: false,
            code: "TOOL_ERROR",
            summary: error.message,
            retryable: descriptor.effect === "read",
          };
          await AgentToolExecution.finish(context.run.id, callId, {
            error: error.message,
            outcomeCode: failure.code,
            retryable: failure.retryable,
            resultSummary: failure.summary,
          });
          await context.emit("tool.failed", {
            callId,
            taskId: context.taskId,
            toolId: descriptor.id,
            operationKey: opKey,
            code: failure.code,
            error: error.message,
          });
          context.rememberOperationResult(opKey, {
            status: "failed",
            result: failure,
            retryable: failure.retryable,
          });
          return JSON.stringify(failure);
        }
      });
    },
    {
      name: descriptor.name,
      description: descriptor.description,
      schema: descriptor.schema,
    }
  );
}

module.exports = {
  activitySummary,
  defineTool,
  normalizeToolResult,
  operationKey,
  reusableExecution,
  reusableResult,
  toLangChainTool,
};
