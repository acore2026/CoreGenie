const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { createMiddleware } = require("langchain");
const { REMOVE_ALL_MESSAGES } = require("@langchain/langgraph");
const {
  HumanMessage,
  RemoveMessage,
  SystemMessage,
} = require("@langchain/core/messages");
const { getEncoding } = require("js-tiktoken");
const {
  convertToOpenAITool,
} = require("@langchain/core/utils/function_calling");
const { contentText, messageRole } = require("./message");

// This configurable first version uses the gateway input budget agreed for ReAct.
const INPUT_LIMIT = 169984;
const TRIGGER_TOKENS = Math.floor(INPUT_LIMIT * 0.95);
const TARGET_TOKENS = Math.floor(INPUT_LIMIT * 0.5);
const SUMMARY_TOKENS = 4000;
const INTERNAL_TAG = "coregenie:context-compaction";
const NOTE_KEY = "coregenie_context_note";
const PROTECTED_TOOLS = new Set([
  "activate_skill",
  "read_skill_resource",
  "skill.activate",
  "skill.read_resource",
]);
let encoder;
let prompts;

function compactionPrompts() {
  if (!prompts) {
    prompts = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../agent-config/context-compaction.json"),
        "utf8"
      )
    );
  }
  return prompts;
}

function countText(text) {
  encoder ||= getEncoding("cl100k_base");
  // Treat special-token-looking strings as ordinary document content.
  return encoder.encode(String(text), [], []).length;
}

function wireMessage(message) {
  return {
    role: messageRole(message),
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.additional_kwargs?.reasoning_content
      ? { reasoning_content: message.additional_kwargs.reasoning_content }
      : {}),
  };
}

function createEstimator(systemPrompt, tools) {
  const fixedTokens =
    countText(systemPrompt || "") +
    countText(JSON.stringify(tools.map((tool) => convertToOpenAITool(tool)))) +
    256;
  const cache = new WeakMap();
  return (messages) =>
    fixedTokens +
    messages.reduce((total, message) => {
      if (!cache.has(message))
        cache.set(
          message,
          countText(JSON.stringify(wireMessage(message))) + 12
        );
      return total + cache.get(message);
    }, 0);
}

function isInternalNote(message) {
  return ["summary", "pruned"].includes(message.additional_kwargs?.[NOTE_KEY]);
}

function note(kind, content) {
  return new HumanMessage({
    id: randomUUID(),
    content,
    additional_kwargs: { [NOTE_KEY]: kind },
  });
}

// One assistant tool call batch and ALL its results form an indivisible unit.
// Interleaved, incomplete, duplicate or orphan results are never removed.
function historyUnits(messages) {
  const units = [];
  for (let index = 0; index < messages.length; index += 1) {
    const first = messages[index];
    const role = messageRole(first);
    const calls = first.tool_calls || [];
    let end = index + 1;
    let toolGroup = false;
    let protectedUnit = !["ai", "assistant"].includes(role);
    if (isInternalNote(first)) protectedUnit = false;
    if (calls.length) {
      protectedUnit = true;
      if (["ai", "assistant"].includes(role)) {
        while (end < messages.length && messageRole(messages[end]) === "tool")
          end += 1;
        const ids = calls.map((call) => call.id);
        const results = messages
          .slice(index + 1, end)
          .map((message) => message.tool_call_id);
        toolGroup =
          ids.every(Boolean) &&
          new Set(ids).size === ids.length &&
          results.length === ids.length &&
          new Set(results).size === results.length &&
          results.every((id) => ids.includes(id));
        protectedUnit =
          !toolGroup || calls.some((call) => PROTECTED_TOOLS.has(call.name));
      }
    }
    units.push({
      start: index,
      end,
      messages: messages.slice(index, end),
      toolGroup,
      protected: protectedUnit,
    });
    index = end - 1;
  }
  // Keep the latest two complete tool batches AND the latest two messages.
  const recentToolStart = units
    .filter((unit) => unit.toolGroup)
    .slice(-2)[0]?.start;
  for (const unit of units) {
    if (
      unit.end > messages.length - 2 ||
      (recentToolStart !== undefined && unit.start >= recentToolStart)
    )
      unit.protected = true;
  }
  return units;
}

function replaceUnits(messages, units, replacement) {
  const removed = new Set(units.flatMap((unit) => unit.messages));
  const first = units[0]?.messages[0];
  return messages.flatMap((message) =>
    message === first ? [replacement] : removed.has(message) ? [] : [message]
  );
}

function pruneNote(unit) {
  const results = unit.messages.slice(1);
  const operations = unit.messages[0].tool_calls.map((call) => {
    const message = results.find((result) => result.tool_call_id === call.id);
    let result = {};
    try {
      const parsed = JSON.parse(contentText(message?.content));
      if (parsed && typeof parsed === "object") result = parsed;
    } catch {
      // Legacy tool responses can be plain text.
    }
    return {
      callId: call.id,
      tool: call.name,
      ...(typeof call.args?.path === "string" ? { path: call.args.path } : {}),
      ...(Array.isArray(result.artifactIds)
        ? { artifactIds: result.artifactIds }
        : {}),
      code: result.code || "FINISHED",
      summary: String(result.summary || contentText(message?.content)).slice(
        0,
        240
      ),
    };
  });
  return note(
    "pruned",
    compactionPrompts().prunedPrefix + "\n" + JSON.stringify(operations)
  );
}

function assertActive(signal) {
  signal?.throwIfAborted();
}

function budgetError() {
  const error = new Error(
    "上下文整理后仍超过安全阈值；用户要求、必要指令和近期工具交互已保留，请根据已保存的产物继续任务。"
  );
  error.code = "CONTEXT_BUDGET_EXCEEDED";
  return error;
}

async function compactHistory({
  messages,
  estimate,
  summarize,
  signal,
  emit = async () => {},
  trigger = TRIGGER_TOKENS,
  target = TARGET_TOKENS,
}) {
  assertActive(signal);
  const before = estimate(messages);
  if (before < trigger) return null;
  const candidates = historyUnits(messages).filter((unit) => !unit.protected);
  let next = messages;
  let summaryUsed = false;
  let summaryFailure = null;
  let prunedGroups = 0;

  if (candidates.length) {
    const removedMessages = candidates.flatMap((unit) => unit.messages);
    const removed = new Set(removedMessages);
    const retained = messages.filter((message) => !removed.has(message));
    try {
      assertActive(signal);
      const summary = await summarize({
        messages: removedMessages,
        userMessages: messages.filter(
          (message) =>
            ["human", "user"].includes(messageRole(message)) &&
            !isInternalNote(message)
        ),
        signal,
      });
      assertActive(signal);
      if (typeof summary !== "string" || !summary.trim())
        throw new Error("EMPTY_SUMMARY");
      const replacement = note(
        "summary",
        compactionPrompts().summaryPrefix + "\n" + summary.trim()
      );
      const proposed = replaceUnits(messages, candidates, replacement);
      if (estimate(proposed) >= before) throw new Error("SUMMARY_NOT_SMALLER");
      // Do not accept a summary that simply reproduces the removed body.
      if (estimate([replacement]) >= estimate(removedMessages))
        throw new Error("SUMMARY_NOT_SMALLER");
      if (retained.some((message) => !proposed.includes(message)))
        throw new Error("PROTECTED_MESSAGE_REMOVED");
      next = proposed;
      summaryUsed = true;
    } catch (error) {
      assertActive(signal);
      summaryFailure = error.code || "SUMMARY_UNAVAILABLE";
    }
  }

  // A 50% target is advisory. Only prune when the 95% trigger still holds.
  if (estimate(next) >= trigger) {
    const groups = historyUnits(next).filter(
      (unit) => unit.toolGroup && !unit.protected
    );
    for (const group of groups) {
      assertActive(signal);
      const proposed = replaceUnits(next, [group], pruneNote(group));
      if (estimate(proposed) >= estimate(next)) continue;
      next = proposed;
      prunedGroups += 1;
      if (estimate(next) < trigger) break;
    }
  }

  assertActive(signal);
  const after = estimate(next);
  if (after >= trigger || after >= before) {
    await emit("context.compaction.failed", {
      estimatedTokensBefore: before,
      estimatedTokensAfter: after,
      triggerTokens: trigger,
      reason: summaryFailure || "PROTECTED_CONTEXT_TOO_LARGE",
    });
    throw budgetError();
  }
  await emit("context.compaction.prepared", {
    estimatedTokensBefore: before,
    estimatedTokensAfter: after,
    triggerTokens: trigger,
    targetTokens: target,
    targetReached: after <= target,
    summaryUsed,
    summaryFailure,
    prunedGroups,
    estimator: "cl100k_base",
  });
  assertActive(signal);
  return next;
}

function contextCompactionMiddleware({
  run,
  systemPrompt,
  tools,
  createSummaryModel,
  signal,
  emit,
  // Test seam: exercise checkpointing with small deterministic budgets.
  estimate = createEstimator(systemPrompt, tools),
  trigger = TRIGGER_TOKENS,
  target = TARGET_TOKENS,
}) {
  return createMiddleware({
    name: "ContextCompaction",
    beforeModel: async (state, runtime) => {
      const activeSignal = signal || runtime.signal;
      const messages = await compactHistory({
        messages: state.messages,
        estimate,
        signal: activeSignal,
        emit,
        trigger,
        target,
        summarize: async ({ messages: old, userMessages, signal }) => {
          const input = [
            new SystemMessage(compactionPrompts().instruction),
            new HumanMessage(
              JSON.stringify({
                task: run.prompt,
                instructions: systemPrompt,
                userMessages: userMessages.map(wireMessage),
                history: old.map(wireMessage),
              })
            ),
          ];
          // A large incoming result may jump past the limit in one step.
          // Never send that same oversized history to the summarizer.
          if (createEstimator("", [])(input) >= INPUT_LIMIT - SUMMARY_TOKENS) {
            const error = new Error("SUMMARY_INPUT_TOO_LARGE");
            error.code = "SUMMARY_INPUT_TOO_LARGE";
            throw error;
          }
          const timeoutSignal = AbortSignal.timeout(120_000);
          const summarySignal = signal
            ? AbortSignal.any([signal, timeoutSignal])
            : timeoutSignal;
          const response = await createSummaryModel().invoke(input, {
            signal: summarySignal,
            tags: [INTERNAL_TAG, "langsmith:nostream"],
            metadata: { purpose: "context-compaction" },
          });
          if (
            response.tool_calls?.length ||
            ["length", "max_tokens"].includes(
              response.response_metadata?.finish_reason
            )
          )
            throw new Error("INCOMPLETE_SUMMARY");
          const text = contentText(response.content);
          if (countText(text) > SUMMARY_TOKENS)
            throw new Error("SUMMARY_OUTPUT_TOO_LARGE");
          return text;
        },
      });
      if (!messages) return;
      // Apply through LangGraph's message reducer, so the replacement is
      // checkpointed before the next model call. Other state is untouched.
      return {
        messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...messages],
      };
    },
  });
}

module.exports = {
  INPUT_LIMIT,
  TRIGGER_TOKENS,
  TARGET_TOKENS,
  SUMMARY_TOKENS,
  INTERNAL_TAG,
  NOTE_KEY,
  compactHistory,
  contextCompactionMiddleware,
  createEstimator,
  historyUnits,
};
