const { AgentRun } = require("../models/agentRun");
const { AgentRunEvent } = require("../models/agentRunEvent");
const { AgentSkillWhitelist } = require("../models/agentSkillWhitelist");
const { agentRunSupervisor } = require("./supervisor");
const { resolveAgent } = require("../resources/agents");
const { createRuntimeSnapshot } = require("./runtimeSnapshot");

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;

function delay(milliseconds, signal = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason || new Error("Agent run aborted."));
      },
      { once: true }
    );
  });
}

async function submitAgentRun({
  workspace,
  thread = null,
  user = null,
  agentId = null,
  source = "api",
  mode = null,
  prompt,
  attachments = [],
  configuration = {},
}) {
  if (!workspace?.id) throw new Error("A workspace is required.");
  if (!String(prompt || "").trim()) throw new Error("A prompt is required.");
  const active = await AgentRun.activeForConversation({
    workspaceId: workspace.id,
    threadId: thread?.id || null,
    userId: user?.id || null,
  });
  if (active) {
    const error = new Error(
      "This conversation already has an active Agent run."
    );
    error.code = "AGENT_RUN_ACTIVE";
    error.run = active;
    throw error;
  }
  const approvalMode =
    configuration.approvalMode ||
    (source === "workspace"
      ? await AgentSkillWhitelist.getApprovalMode()
      : "always_allow");
  const agent = await resolveAgent(agentId);
  if (!agent) throw new Error("No enabled Agent is configured.");
  const snapshot = await createRuntimeSnapshot({
    agent,
    workspace,
    user,
    configuration,
  });
  const run = await AgentRun.create({
    workspaceId: workspace.id,
    threadId: thread?.id || null,
    userId: user?.id || null,
    agentId: agent.id,
    source,
    mode: mode || workspace.chatMode || "automatic",
    prompt: String(prompt),
    attachments,
    configuration: {
      ...configuration,
      approvalMode,
      maxToolCalls: Math.min(Number(configuration.maxToolCalls) || 500, 500),
    },
    policySnapshot: {
      approvalMode,
      maxToolCalls: Math.min(Number(configuration.maxToolCalls) || 500, 500),
      maxTasks: 12,
      maxConcurrency: 3,
      maxReviewRounds: 2,
      maxTaskToolCalls: 100,
      maxTaskModelCalls: 100,
    },
    ...snapshot,
  });
  await AgentRunEvent.append(run.id, "run.queued", { status: "queued" });
  agentRunSupervisor.enqueue(run.id);
  return run;
}

async function followAgentRun(
  runId,
  {
    after = 0,
    onEvent = null,
    signal = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}
) {
  let cursor = Number(after) || 0;
  const startedAt = Date.now();
  while (true) {
    if (signal?.aborted) throw signal.reason || new Error("Agent run aborted.");
    for (const event of await AgentRunEvent.after(runId, cursor, 1_000)) {
      cursor = event.id;
      if (onEvent) await onEvent(event);
    }
    const run = await AgentRun.get(runId);
    if (!run) throw new Error("Agent run not found.");
    if (AgentRun.isTerminal(run.status)) return run;
    if (["waiting_for_input", "waiting_for_approval"].includes(run.status))
      return run;
    if (Date.now() - startedAt > timeoutMs) {
      await agentRunSupervisor.cancel(run.id);
      throw new Error("Agent run timed out.");
    }
    await delay(50, signal);
  }
}

async function runAgentToCompletion(options, followOptions = {}) {
  const run = await submitAgentRun(options);
  const events = [];
  const terminal = await followAgentRun(run.id, {
    ...followOptions,
    onEvent: async (event) => {
      events.push(event);
      if (followOptions.onEvent) await followOptions.onEvent(event);
    },
  });
  if (!["completed", "partial"].includes(terminal.status)) {
    if (["waiting_for_input", "waiting_for_approval"].includes(terminal.status))
      throw new Error(
        "This request requires interactive input and cannot finish in this channel."
      );
    throw new Error(terminal.error || `Agent run ${terminal.status}.`);
  }
  const completed = events
    .filter((event) => ["run.completed", "run.partial"].includes(event.type))
    .at(-1);
  return {
    run: terminal,
    events,
    textResponse: terminal.finalResponse || "",
    sources: completed?.payload?.sources || [],
    chatId: completed?.payload?.chatId || null,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  submitAgentRun,
  followAgentRun,
  runAgentToCompletion,
};
