const { AgentRun } = require("../models/agentRun");
const { AgentRunEvent } = require("../models/agentRunEvent");
const { AgentRunTask } = require("../models/agentRunTask");
const { AgentToolExecution } = require("../models/agentToolExecution");
const { Workspace } = require("../models/workspace");
const { WorkspaceChats } = require("../models/workspaceChats");
const { WorkspaceThread } = require("../models/workspaceThread");
const { User } = require("../models/user");
const { AgentReportPublication } = require("../models/agentReportPublication");
const { publicationOutput } = require("../tools/knowledge");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");
const { resolveAgent } = require("../resources/agents");
const { normalizedHistory } = require("./message");
const { withAgentTrace } = require("./observability");
const { requireRuntime } = require("./runtimes/registry");
const { consumeGraphStream } = require("./runtimes/stream");
const { deleteCheckpointThread } = require("./checkpointer");

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

function applicableCompletionTools(requiredToolIds = [], tasks = []) {
  if (!tasks.length) return requiredToolIds;
  const allowed = new Set(tasks.flatMap((task) => task.allowedToolIds || []));
  return requiredToolIds.filter((toolId) => allowed.has(toolId));
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
    phase: "initializing",
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
    summaryKey: "understanding",
    summaryArgs: {
      request: run.prompt.replace(/\s+/g, " ").slice(0, 120),
    },
  });

  const configuredHistory = run.configuration?.history;
  const history = Array.isArray(configuredHistory)
    ? normalizedHistory(configuredHistory)
    : await WorkspaceChats.where(
        {
          workspaceId: workspace.id,
          thread_id: thread?.id || null,
          ...(thread?.id ? {} : { user_id: user?.id || null }),
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
      phase: inputRequest ? "input" : "approval",
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

  let responseText = String(result.text || streamedText || "");
  let partial = Boolean(result.partial);
  const requiredCompletionTools = applicableCompletionTools(
    run.runtimeSnapshot?.runtimeConfig?.requiredCompletionTools || [],
    await AgentRunTask.list(run.id)
  );
  if (requiredCompletionTools.length) {
    const completed = new Set(
      await AgentToolExecution.completedToolIds(run.id)
    );
    const missing = requiredCompletionTools.filter(
      (toolId) => !completed.has(toolId)
    );
    if (missing.length) {
      partial = true;
      const warning = `\n\n未完成自动发布：缺少成功的 ${missing.join(
        ", "
      )} 工具执行。报告如已生成，仍保留在 Workspace 文件中。`;
      responseText += warning;
      if (streamedText)
        await emit("message.delta", { messageId, delta: warning });
    }
  }
  const sources = Array.isArray(result.sources) ? result.sources : [];
  if (!responseText.trim())
    throw new Error("The Agent returned an empty response.");
  if (!streamedText)
    await emit("message.delta", { messageId, delta: responseText });
  const traces =
    run.runtimeKey === "governed-agent"
      ? {}
      : historicalTrace(await AgentRunEvent.after(run.id, 0, 10_000));
  const publicationRows = await AgentReportPublication.forRun(run.id);
  const workspaceManager = filesystem.forWorkspace(workspace.id);
  await workspaceManager.ensureInitialized();
  const outputs = [];
  for (const publication of publicationRows) {
    try {
      const absolute = await workspaceManager.validatePath(
        publication.sourcePath
      );
      const stats = await require("fs/promises").stat(absolute);
      outputs.push(publicationOutput(publication, workspace, stats));
    } catch {}
  }
  const { chat, message } =
    run.configuration?.persistChat === false
      ? { chat: null, message: null }
      : await WorkspaceChats.new({
          workspaceId: workspace.id,
          prompt: run.prompt,
          response: {
            text: responseText,
            sources,
            outputs,
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
    outputs,
  });
  const terminalStatus = partial ? "partial" : "completed";
  await AgentRun.update(run.id, {
    status: terminalStatus,
    phase: "complete",
    terminationReason: partial ? "partial_results" : "completed",
    finalResponse: responseText,
    completedAt: new Date(),
  });
  await emit("activity.updated", {
    phase: "complete",
    summary: "Completed",
    summaryKey: "completed",
  });

  if (thread && run.configuration?.autoTitle !== false) {
    await WorkspaceThread.autoRenameThread({
      workspace,
      thread,
      user,
      onRename: (renamed) =>
        emit("thread.renamed", { slug: renamed.slug, name: renamed.name }),
    }).catch((error) => console.error(error.message));
  }
  await Promise.allSettled([
    AgentToolExecution.reconcileActive(run.id),
    AgentRunTask.reconcileTerminal(run.id, "cancelled"),
  ]);
  await emit(partial ? "run.partial" : "run.completed", {
    status: terminalStatus,
    chatId: chat?.id || null,
    sources,
    outputs,
  });
  await deleteCheckpointThread(run.checkpointThreadId);
  return AgentRun.get(run.id);
}

async function persistFailedAgentRun(runId, error) {
  const run = await AgentRun.get(runId);
  if (!run || AgentRun.isTerminal(run.status)) return run;
  const workspace = await Workspace.get({ id: run.workspace_id });
  if (!workspace) return run;
  const user = run.user_id ? await User.get({ id: run.user_id }) : null;
  const thread = run.thread_id
    ? await WorkspaceThread.get({
        id: run.thread_id,
        workspace_id: workspace.id,
      })
    : null;
  const tasks = await AgentRunTask.list(run.id);
  const completed = tasks.filter(
    (task) => task.status === "completed" && task.resultSummary
  );
  const partial = completed.length > 0;
  const responseText = partial
    ? `${completed.map((task) => task.resultSummary).join("\n\n")}\n\nIncomplete work: ${error.message}`
    : `I could not complete this request: ${error.message}`;
  const { chat } =
    run.configuration?.persistChat === false
      ? { chat: null }
      : await WorkspaceChats.new({
          workspaceId: workspace.id,
          prompt: run.prompt,
          response: {
            text: responseText,
            sources: [],
            type: run.mode,
            attachments: run.attachments,
            agentRunId: run.id,
            agentId: run.agent_id,
            error: partial ? null : error.message,
          },
          threadId: thread?.id || null,
          include: run.configuration?.include ?? true,
          apiSessionId: run.configuration?.apiSessionId || null,
          user,
        });
  return {
    run,
    chatId: chat?.id || null,
    partial,
    responseText,
  };
}

module.exports = {
  applicableCompletionTools,
  consumeGraphStream,
  executeAgentRun,
  executeAgentRunSegment,
  persistFailedAgentRun,
  historicalTrace,
  snapshottedAgent,
};
