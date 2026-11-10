const { AgentRun } = require("../models/agentRun");
const { AgentRunEvent } = require("../models/agentRunEvent");
const { AgentRunTask } = require("../models/agentRunTask");
const { AgentToolExecution } = require("../models/agentToolExecution");
const { Workspace } = require("../models/workspace");
const { WorkspaceChats } = require("../models/workspaceChats");
const { WorkspaceThread } = require("../models/workspaceThread");
const { User } = require("../models/user");
const { AgentReportPublication } = require("../models/agentReportPublication");
const { AgentRunArtifact } = require("../models/agentRunArtifact");
const { v4: uuidv4 } = require("uuid");
const { publicationOutput } = require("../tools/knowledge");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");
const { resolveAgent } = require("../resources/agents");
const { normalizedHistory } = require("./message");
const { withAgentTrace } = require("./observability");
const { requireRuntime } = require("./runtimes/registry");
const { consumeGraphStream } = require("./runtimes/stream");
const { deleteCheckpointThread } = require("./checkpointer");
const {
  appendText,
  appendToolCall,
  cloneParts,
  paragraphSeparator,
  partsFromEvents,
  plainTextFromParts,
} = require("./messageTimeline");
const {
  artifactOutput,
  collectRunOutputs,
  completeInlineDatasetResponse,
  registerRunArtifacts,
} = require("./artifactRegistration");

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
        title: `已召回 ${event.payload.count} 条记忆`,
        details: event.payload.memories,
      });
    if (event.type === "context.rag.recalled")
      contextTraces.push({
        id: `${event.runId}:rag:${event.id}`,
        kind: "rag",
        title: `已找到 ${event.payload.count} 条工作区资料`,
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
  // Run-level completion tools apply only when the plan assigned them to a
  // worker task. A direct controller answer has no publication obligation.
  if (!tasks.length) return [];
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

  run = await AgentRun.update(
    run.id,
    {
      status: "running",
      phase: "initializing",
      agent_id: agent.id,
      startedAt: run.startedAt || new Date(),
    },
    { onlyActive: true }
  );
  if (!run || AgentRun.isTerminal(run.status)) return run;
  await emit("run.started", {
    status: "running",
    agent: { id: agent.id, name: agent.name },
    runtime: { key: definition.id, version: definition.version },
  });
  if (!run.parent_run_id && thread && run.configuration?.autoTitle !== false) {
    void WorkspaceThread.autoRenameThread({
      prompt: run.prompt,
      workspace,
      thread,
      user,
      onRename: (renamed) =>
        emit("thread.renamed", { slug: renamed.slug, name: renamed.name }),
    }).catch((error) => console.error(error.message));
  }
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
  const usesReactTimeline = definition.id === "default-react";
  const segmentId = uuidv4();
  const previousEvents = usesReactTimeline
    ? await AgentRunEvent.after(run.id, 0, 50_000)
    : [];
  const messageParts = usesReactTimeline
    ? partsFromEvents(previousEvents, messageId)
    : [];
  let streamedText = usesReactTimeline ? plainTextFromParts(messageParts) : "";
  let deltaBuffer = "";
  let partDeltaBuffer = "";
  let deltaPartId = null;
  let currentTurnId = null;
  let lastDeltaFlush = Date.now();
  const flushDelta = async () => {
    if (!deltaBuffer) return;
    const delta = deltaBuffer;
    const partDelta = partDeltaBuffer;
    const partId = deltaPartId;
    deltaBuffer = "";
    partDeltaBuffer = "";
    deltaPartId = null;
    lastDeltaFlush = Date.now();
    await emit("message.delta", {
      messageId,
      delta,
      ...(usesReactTimeline ? { partId, partDelta } : {}),
    });
  };
  const scopedTurnId = (turnId) => `${segmentId}:${turnId || "turn-1"}`;
  const onAssistantTurn = async ({ turnId } = {}) => {
    if (!usesReactTimeline) return;
    const nextTurnId = scopedTurnId(turnId);
    if (currentTurnId === nextTurnId) return;
    await flushDelta();
    currentTurnId = nextTurnId;
  };
  const onToken = async (token, { turnId } = {}) => {
    if (!usesReactTimeline) {
      streamedText += token;
      deltaBuffer += token;
    } else {
      const nextTurnId = scopedTurnId(turnId);
      if (currentTurnId !== nextTurnId) await onAssistantTurn({ turnId });
      const partId = `text:${currentTurnId}`;
      if (deltaPartId && deltaPartId !== partId) await flushDelta();
      const existingPart = messageParts.find((part) => part.id === partId);
      const separator = existingPart ? "" : paragraphSeparator(streamedText);
      appendText(messageParts, partId, token);
      streamedText += `${separator}${token}`;
      deltaPartId = partId;
      deltaBuffer += `${separator}${token}`;
      partDeltaBuffer += token;
    }
    if (deltaBuffer.length >= 80 || Date.now() - lastDeltaFlush >= 50)
      await flushDelta();
  };
  const runtimeEmit = async (type, payload = {}) => {
    if (!usesReactTimeline || !type.startsWith("tool.") || !payload.callId)
      return emit(type, payload);
    await flushDelta();
    if (!currentTurnId) currentTurnId = scopedTurnId("unscoped");
    const groupId = `tools:${currentTurnId}`;
    appendToolCall(messageParts, groupId, payload.callId);
    return emit(type, {
      ...payload,
      messageId,
      turnId: currentTurnId,
      groupId,
    });
  };

  const result = await runtime.executeSegment({
    run,
    workspace,
    user,
    thread,
    agent,
    history,
    emit: runtimeEmit,
    signal,
    runnableConfig,
    onToken,
    onAssistantTurn,
  });
  const currentRun = await AgentRun.get(run.id);
  if (AgentRun.isTerminal(currentRun?.status)) return currentRun;
  signal?.throwIfAborted();
  await flushDelta();

  if (result.kind === "interrupt") {
    const pendingInterrupt = result.interrupt;
    const inputRequest = pendingInterrupt.kind === "input";
    const interrupted = await AgentRun.update(
      run.id,
      {
        status: inputRequest ? "waiting_for_input" : "waiting_for_approval",
        phase: inputRequest ? "input" : "approval",
        configuration: { ...run.configuration, resume: null, recover: false },
      },
      { onlyActive: true }
    );
    if (!interrupted || AgentRun.isTerminal(interrupted.status))
      return interrupted;
    await emit(
      inputRequest ? "input.requested" : "approval.requested",
      inputRequest
        ? pendingInterrupt
        : { requestId: `${run.id}:approval`, ...pendingInterrupt }
    );
    await emit("activity.updated", {
      phase: inputRequest ? "input" : "approval",
      requestId: inputRequest ? pendingInterrupt.requestId : undefined,
      summaryKey: inputRequest ? "waiting_for_input" : "waiting_for_approval",
    });
    return AgentRun.get(run.id);
  }

  if (
    usesReactTimeline &&
    !plainTextFromParts(messageParts) &&
    String(result.text || "")
  ) {
    await onAssistantTurn({ turnId: "completion" });
    await onToken(String(result.text), { turnId: "completion" });
    await flushDelta();
  }
  let responseText = usesReactTimeline
    ? plainTextFromParts(messageParts)
    : String(result.text || streamedText || "");
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
      const warning = `未完成自动发布：缺少成功的 ${missing.join(
        ", "
      )} 工具执行。报告如已生成，仍保留在 Workspace 文件中。`;
      if (usesReactTimeline) {
        await onAssistantTurn({ turnId: "completion-warning" });
        await onToken(warning, { turnId: "completion-warning" });
        await flushDelta();
        responseText = plainTextFromParts(messageParts);
      } else {
        responseText += `\n\n${warning}`;
        if (streamedText)
          await emit("message.delta", { messageId, delta: `\n\n${warning}` });
      }
    }
  }
  const sources = Array.isArray(result.sources) ? result.sources : [];
  if (!responseText.trim())
    throw new Error("The Agent returned an empty response.");
  const traces =
    run.runtimeKey === "governed-agent"
      ? {}
      : historicalTrace(await AgentRunEvent.after(run.id, 0, 10_000));
  const workspaceManager = filesystem.forWorkspace(workspace.id);
  await workspaceManager.ensureInitialized();
  const publicationRows = await AgentReportPublication.forRun(run.id);
  const tasks = await AgentRunTask.list(run.id);
  const referencedArtifacts = await registerRunArtifacts({
    runId: run.id,
    tasks,
    finalResponse: responseText,
    workspaceManager,
  });
  const artifactRows = await AgentRunArtifact.forRun(run.id);
  const completedResponse = await completeInlineDatasetResponse({
    request: run.prompt,
    responseText,
    artifacts: artifactRows,
    workspaceManager,
  });
  responseText = completedResponse.text;
  if (streamedText && completedResponse.addition) {
    if (usesReactTimeline) {
      await onAssistantTurn({ turnId: "completion-artifacts" });
      await onToken(completedResponse.addition.replace(/^\n+/, ""), {
        turnId: "completion-artifacts",
      });
      await flushDelta();
      responseText = plainTextFromParts(messageParts);
    } else {
      await emit("message.delta", {
        messageId,
        delta: completedResponse.addition,
      });
    }
  }
  if (!streamedText)
    await emit("message.delta", { messageId, delta: responseText });
  const outputs = [];
  const outputPaths = new Set();
  for (const publication of publicationRows) {
    try {
      const absolute = await workspaceManager.validatePath(
        publication.sourcePath
      );
      const stats = await require("fs/promises").stat(absolute);
      outputs.push(publicationOutput(publication, workspace, stats));
      outputPaths.add(publication.sourcePath);
    } catch {}
  }
  outputs.push(
    ...(
      await collectRunOutputs({
        runId: run.id,
        workspace,
        workspaceManager,
        artifacts: [...referencedArtifacts, ...artifactRows],
      })
    ).filter((output) => !outputPaths.has(output.payload.path))
  );
  const terminalStatus = partial ? "partial" : "completed";
  const persisted = await AgentRun.finalizeWithResponse(run.id, {
    status: terminalStatus,
    terminationReason: partial ? "partial_results" : "completed",
    response: {
      text: responseText,
      sources,
      outputs,
      type: run.mode,
      attachments: run.attachments,
      agentRunId: run.id,
      agentId: agent.id,
      runtime: { key: definition.id, version: definition.version },
      ...(usesReactTimeline && messageParts.length
        ? { parts: cloneParts(messageParts) }
        : {}),
      ...traces,
    },
  });
  if (!persisted) return AgentRun.get(run.id);
  const { chat } = persisted;

  await emit("message.completed", {
    messageId,
    text: responseText,
    chatId: chat?.id || null,
    outputs,
    ...(usesReactTimeline && messageParts.length
      ? { parts: cloneParts(messageParts) }
      : {}),
  });
  await emit("activity.updated", {
    phase: "complete",
    summary: "Completed",
    summaryKey: "completed",
  });

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

async function interruptedAgentResponse(
  run,
  error,
  { cancelled = false } = {}
) {
  const tasks = await AgentRunTask.list(run.id);
  const completed = tasks.filter(
    (task) => task.status === "completed" && task.resultSummary
  );
  const usesReactTimeline = run.runtimeKey === "default-react";
  const messageId = `${run.id}:assistant`;
  const messageParts = usesReactTimeline
    ? partsFromEvents(await AgentRunEvent.after(run.id, 0, 50_000), messageId)
    : [];
  const previousText = plainTextFromParts(messageParts);
  const partial = completed.length > 0 || Boolean(previousText.trim());
  const failureText = cancelled
    ? partial
      ? "任务已停止，以上是停止前的内容。"
      : "任务已停止。"
    : partial
      ? `Incomplete work: ${error.message}`
      : `I could not complete this request: ${error.message}`;
  let streamDelta = null;
  let responseText;
  if (usesReactTimeline) {
    const partId = `text:failure:${uuidv4()}`;
    const separator = paragraphSeparator(previousText);
    appendText(messageParts, partId, failureText);
    responseText = plainTextFromParts(messageParts);
    streamDelta = {
      delta: `${separator}${failureText}`,
      partId,
      partDelta: failureText,
    };
  } else {
    responseText = partial
      ? `${completed.map((task) => task.resultSummary).join("\n\n")}\n\n${failureText}`
      : failureText;
  }
  return {
    partial,
    streamDelta,
    response: {
      text: responseText,
      sources: [],
      type: run.mode,
      attachments: run.attachments,
      agentRunId: run.id,
      agentId: run.agent_id,
      ...(usesReactTimeline
        ? {
            runtime: {
              key: run.runtimeKey,
              version: run.runtimeVersion,
            },
            parts: cloneParts(messageParts),
          }
        : {}),
      error: cancelled || partial ? null : error.message,
    },
  };
}

async function persistFailedAgentRun(
  runId,
  error,
  { cancelled = false, timedOut = false, recoverCancelled = false } = {}
) {
  const run = await AgentRun.get(runId);
  if (
    !run ||
    (AgentRun.isTerminal(run.status) &&
      !(cancelled && recoverCancelled && run.status === "cancelled"))
  )
    return null;
  const workspace = await Workspace.get({ id: run.workspace_id });
  if (!workspace) throw new Error("Agent run workspace no longer exists.");
  const { response, partial, streamDelta } = await interruptedAgentResponse(
    run,
    error,
    { cancelled }
  );
  // Keep completed files downloadable even if a later step fails or is stopped.
  try {
    const workspaceManager = filesystem.forWorkspace(workspace.id);
    await workspaceManager.ensureInitialized();
    const referencedArtifacts = await registerRunArtifacts({
      runId: run.id,
      tasks: await AgentRunTask.list(run.id),
      finalResponse: response.text,
      workspaceManager,
    });
    response.outputs = await collectRunOutputs({
      runId: run.id,
      workspace,
      workspaceManager,
      artifacts: [
        ...referencedArtifacts,
        ...(await AgentRunArtifact.forRun(run.id)),
      ],
    });
  } catch (artifactError) {
    console.warn(
      "[Agent artifacts] Unable to restore outputs:",
      artifactError.message
    );
  }
  const persisted = await AgentRun.finalizeWithResponse(run.id, {
    response,
    status: cancelled ? "cancelled" : partial ? "partial" : "failed",
    terminationReason: cancelled
      ? "cancelled_by_user"
      : timedOut
        ? "run_time_budget_exhausted"
        : partial
          ? "partial_results_after_error"
          : "runtime_error",
    error: error.message,
    recoverCancelled,
  });
  if (!persisted) return null;
  return {
    run: persisted.run,
    chatId: persisted.chat?.id || null,
    partial,
    responseText: persisted.run.finalResponse,
    streamDelta,
    messageParts: response.parts || null,
    outputs: response.outputs || [],
  };
}

module.exports = {
  applicableCompletionTools,
  artifactOutput,
  consumeGraphStream,
  executeAgentRun,
  executeAgentRunSegment,
  interruptedAgentResponse,
  persistFailedAgentRun,
  historicalTrace,
  snapshottedAgent,
};
