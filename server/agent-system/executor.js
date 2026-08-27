const { AgentRun } = require("../models/agentRun");
const { AgentRunEvent } = require("../models/agentRunEvent");
const { Workspace } = require("../models/workspace");
const { WorkspaceChats } = require("../models/workspaceChats");
const { WorkspaceThread } = require("../models/workspaceThread");
const { User } = require("../models/user");
const { resolveAgent } = require("../resources/agents");
const { normalizedHistory } = require("./message");
const { withAgentTrace } = require("./observability");
const { requireRuntime } = require("./runtimes/registry");
const { consumeGraphStream } = require("./runtimes/stream");

function historicalTrace(events = []) {
  const agentTrace = events
    .filter((event) => event.type === "activity.updated")
    .map((event) => ({
      id: `${event.runId}:activity:${event.id}`,
      phase: event.payload.phase,
      summary: event.payload.summary,
      createdAt: event.createdAt,
    }));
  const subagents = new Map();
  const contextTraces = [];
  for (const event of events) {
    if (event.type.startsWith("subagent.")) {
      subagents.set(event.payload.childRunId, {
        id: event.payload.childRunId,
        task: event.payload.task,
        agent: event.payload.agent,
        depth: event.payload.depth,
        response: event.payload.response,
        error: event.payload.error,
        status: event.type.slice("subagent.".length),
      });
    }
    if (event.type === "context.memory.recalled")
      contextTraces.push({
        id: `${event.runId}:memory:${event.id}`,
        kind: "memory",
        title: `Recalled ${event.payload.count} memories`,
        details: event.payload.memories,
      });
    if (event.type === "context.rag.recalled")
      contextTraces.push({
        id: `${event.runId}:rag:${event.id}`,
        kind: "rag",
        title: `Used ${event.payload.count} knowledge sources`,
        details: event.payload.sources,
      });
  }
  return {
    agentTrace,
    subagentRuns: [...subagents.values()],
    contextTraces,
  };
}

function snapshottedAgent(run) {
  const agent = run.runtimeSnapshot?.agent;
  if (!agent?.id) return null;
  return {
    ...agent,
    runtimeKey: run.runtimeKey,
    runtimeConfig: run.runtimeSnapshot?.runtimeConfig || {},
  };
}

async function executeAgentRun(runId, signal) {
  const run = await AgentRun.get(runId);
  if (!run || AgentRun.isTerminal(run.status)) return run;

  return withAgentTrace(run, (runnableConfig) =>
    executeAgentRunSegment(run, signal, runnableConfig)
  );
}

async function executeAgentRunSegment(initialRun, signal, runnableConfig = {}) {
  let run = initialRun;
  const emit = (type, payload = {}) =>
    AgentRunEvent.append(run.id, type, payload);
  const workspace = await Workspace.get({ id: run.workspace_id });
  if (!workspace) throw new Error("Agent run workspace no longer exists.");
  const user = run.user_id ? await User.get({ id: run.user_id }) : null;
  const thread = run.thread_id
    ? await WorkspaceThread.get({
        id: run.thread_id,
        workspace_id: workspace.id,
      })
    : null;
  const agent = snapshottedAgent(run) || (await resolveAgent(run.agent_id));
  if (!agent) throw new Error("No enabled Agent is configured.");
  const { definition, runtime } = requireRuntime(
    run.runtimeKey || "default-react",
    run.runtimeVersion || 1
  );

  run = await AgentRun.update(run.id, {
    status: "running",
    agent_id: agent.id,
    startedAt: run.startedAt || new Date(),
  });
  await emit("run.started", {
    status: "running",
    agent: { id: agent.id, name: agent.name },
    runtime: { key: definition.id, version: definition.version },
  });
  await emit("activity.updated", {
    phase: "planning",
    summary: `Understanding: ${run.prompt.replace(/\s+/g, " ").slice(0, 120)}`,
  });

  const configuredHistory = run.configuration?.history;
  const history = Array.isArray(configuredHistory)
    ? normalizedHistory(configuredHistory)
    : await WorkspaceChats.where(
        {
          workspaceId: workspace.id,
          thread_id: thread?.id || null,
          user_id: user?.id || null,
          api_session_id: run.configuration?.apiSessionId || null,
          include: true,
        },
        workspace.openAiHistory || 20,
        { id: "desc" }
      ).then((rows) => normalizedHistory(rows.reverse()));

  const messageId = `${run.id}:assistant`;
  await emit("message.started", { messageId, role: "assistant" });
  let streamedText = "";
  let deltaBuffer = "";
  let lastDeltaFlush = Date.now();
  const flushDelta = async () => {
    if (!deltaBuffer) return;
    const delta = deltaBuffer;
    deltaBuffer = "";
    lastDeltaFlush = Date.now();
    await emit("message.delta", { messageId, delta });
  };
  const onToken = async (token) => {
    streamedText += token;
    deltaBuffer += token;
    if (deltaBuffer.length >= 80 || Date.now() - lastDeltaFlush >= 50)
      await flushDelta();
  };

  const result = await runtime.executeSegment({
    run,
    workspace,
    user,
    thread,
    agent,
    history,
    emit,
    signal,
    runnableConfig,
    onToken,
  });
  await flushDelta();

  if (result.kind === "interrupt") {
    const pendingInterrupt = result.interrupt;
    const inputRequest = pendingInterrupt.kind === "input";
    await AgentRun.update(run.id, {
      status: inputRequest ? "waiting_for_input" : "waiting_for_approval",
      configuration: { ...run.configuration, resume: null, recover: false },
    });
    await emit(
      inputRequest ? "input.requested" : "approval.requested",
      inputRequest
        ? pendingInterrupt
        : { requestId: `${run.id}:approval`, ...pendingInterrupt }
    );
    await emit("activity.updated", {
      phase: inputRequest ? "input" : "approval",
      summary: inputRequest
        ? "Waiting for your input"
        : "Waiting for tool approval",
    });
    return AgentRun.get(run.id);
  }

  const responseText = String(result.text || streamedText || "");
  const sources = Array.isArray(result.sources) ? result.sources : [];
  if (!responseText.trim())
    throw new Error("The Agent returned an empty response.");
  if (!streamedText)
    await emit("message.delta", { messageId, delta: responseText });
  const traces = historicalTrace(await AgentRunEvent.after(run.id, 0, 10_000));
  const { chat, message } =
    run.configuration?.persistChat === false
      ? { chat: null, message: null }
      : await WorkspaceChats.new({
          workspaceId: workspace.id,
          prompt: run.prompt,
          response: {
            text: responseText,
            sources,
            type: run.mode,
            attachments: run.attachments,
            agentRunId: run.id,
            agentId: agent.id,
            runtime: { key: definition.id, version: definition.version },
            ...traces,
          },
          threadId: thread?.id || null,
          include: run.configuration?.include ?? true,
          apiSessionId: run.configuration?.apiSessionId || null,
          user,
        });
  if (run.configuration?.persistChat !== false && !chat)
    throw new Error(message || "Failed to save Agent response.");

  await emit("message.completed", {
    messageId,
    text: responseText,
    chatId: chat?.id || null,
  });
  await AgentRun.update(run.id, {
    status: "completed",
    finalResponse: responseText,
    completedAt: new Date(),
  });
  await emit("activity.updated", { phase: "complete", summary: "Completed" });

  if (thread && run.configuration?.autoTitle !== false) {
    await WorkspaceThread.autoRenameThread({
      workspace,
      thread,
      user,
      onRename: (renamed) =>
        emit("thread.renamed", { slug: renamed.slug, name: renamed.name }),
    }).catch((error) => console.error(error.message));
  }
  await emit("run.completed", {
    status: "completed",
    chatId: chat?.id || null,
    sources,
  });
  return AgentRun.get(run.id);
}

module.exports = {
  consumeGraphStream,
  executeAgentRun,
  executeAgentRunSegment,
  historicalTrace,
  snapshottedAgent,
};
