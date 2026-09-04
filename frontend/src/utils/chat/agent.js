import { v4 } from "uuid";
import { safeJsonParse } from "../request";
import { API_BASE } from "../constants";
import { useEffect, useState } from "react";
import { emitAssistantMessageCompleteEvent } from "@/components/contexts/TTSProvider";
import { THREAD_RENAME_EVENT } from "@/components/Sidebar/ActiveWorkspaces/ThreadContainer";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { baseHeaders } from "../request";
import { appendResourceTrace } from "./agentResourceTraces";

export const AGENT_SESSION_START = "agentSessionStart";
export const AGENT_SESSION_END = "agentSessionEnd";

// Citations arrive as a terminal websocket event that must match an existing message by
// uuid. On a thread's first message the empty->chat transition remounts the chat and
// replays the send, so the citations event can land before its message exists in history.
// Buffer by uuid (module scope survives the remount) and attach when the message appears.
const bufferedCitations = new Map();
function takeBufferedCitations(uuid) {
  if (!uuid || !bufferedCitations.has(uuid)) return [];
  const citations = bufferedCitations.get(uuid);
  bufferedCitations.delete(uuid);
  return citations;
}
const handledEvents = [
  "statusResponse",
  "fileDownloadCard",
  "scheduledJobCreated",
  "awaitingFeedback",
  "wssFailure",
  "rechartVisualize",
  "toolApprovalRequest",
  "clarificationRequest",
  // Streaming events
  "reportStreamEvent",
];

/** Browser-side SSE transport with authenticated POST commands. */
export class AgentSSETransport extends EventTarget {
  constructor(uuid) {
    super();
    this.uuid = uuid;
    this.readyState = WebSocket.CONNECTING;
    this.supportsAgentStreaming = false;
    this.controller = new AbortController();
    this.#connect();
  }

  async #connect() {
    try {
      await fetchEventSource(`${API_BASE}/agent-runs/${this.uuid}/events`, {
        method: "GET",
        headers: baseHeaders(),
        signal: this.controller.signal,
        openWhenHidden: true,
        onopen: async (response) => {
          if (!response.ok)
            throw new Error(
              `Agent SSE connection failed with status ${response.status}.`
            );
          this.readyState = WebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        },
        onmessage: (message) => {
          this.dispatchEvent(
            new MessageEvent("message", { data: message.data })
          );
        },
        onclose: () => this.#finish(),
        onerror: (error) => {
          throw error;
        },
      });
    } catch (error) {
      if (this.controller.signal.aborted) return this.#finish();
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
      this.#finish();
    }
  }

  send(jsonData) {
    if (this.readyState !== WebSocket.OPEN) return;
    const message = safeJsonParse(jsonData, {});
    const command = ["stop", "cancel", "/exit"].includes(
      message?.feedback || message?.type
    )
      ? { type: "cancel" }
      : message;
    fetch(`${API_BASE}/agent-runs/${this.uuid}/commands`, {
      method: "POST",
      headers: { ...baseHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(command),
    })
      .then((response) => {
        if (response.ok) return;
        throw new Error(`Agent message failed with status ${response.status}.`);
      })
      .catch((error) => {
        this.dispatchEvent(new CustomEvent("error", { detail: error }));
      });
  }

  close() {
    if (
      this.readyState === WebSocket.CLOSING ||
      this.readyState === WebSocket.CLOSED
    )
      return;
    this.readyState = WebSocket.CLOSING;
    this.controller.abort();
    this.#finish();
  }

  #finish() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

function legacyEventFromAgentRun(event) {
  if (!event?.runId || !event?.type || !event?.payload) return event;
  const { runId, type, payload } = event;
  if (
    type === "activity.updated" ||
    type.startsWith("input.") ||
    type.startsWith("plan.") ||
    type.startsWith("task.") ||
    type.startsWith("tool.") ||
    type.startsWith("context.") ||
    type.startsWith("skill.") ||
    type.startsWith("subagent.") ||
    type.startsWith("run.")
  )
    return {
      type: "agentRunEvent",
      content: {
        runId,
        event: { id: event.id, type, payload, createdAt: event.createdAt },
      },
    };
  if (type === "message.delta")
    return {
      type: "reportStreamEvent",
      content: {
        type: "textResponseChunk",
        uuid: payload.messageId,
        content: payload.delta,
        agentRunId: runId,
        agentRunEvent: {
          id: event.id,
          runId,
          type,
          payload,
          createdAt: event.createdAt,
        },
      },
    };
  if (type === "message.completed")
    return {
      type: "reportStreamEvent",
      content: {
        type: "chatId",
        uuid: payload.messageId,
        chatId: payload.chatId,
        agentRunId: runId,
        parts: payload.parts,
        agentRunEvent: {
          id: event.id,
          runId,
          type,
          payload,
          createdAt: event.createdAt,
        },
      },
    };
  if (type === "approval.requested") {
    const actions = payload.actionRequests || [];
    const first = actions[0] || {};
    return {
      type: "toolApprovalRequest",
      requestId: payload.requestId,
      skillName:
        actions.length > 1 ? `${actions.length} tool actions` : first.name,
      payload: actions.length > 1 ? { actions } : first.args,
      description: first.description || "Review the requested tool execution",
      allowRemember: actions.length === 1,
    };
  }
  if (type === "thread.renamed")
    return { type: "rename_thread", content: payload };
  return null;
}

const MAX_AGENT_ACTIVITIES = 24;

function resourceTraceFromEvent(event) {
  const { type, payload = {} } = event;
  const base = {
    id: `${event.runId || "run"}:resource:${event.id ?? `${type}:${event.createdAt || Date.now()}`}`,
    createdAt: event.createdAt,
  };
  if (type === "skill.activated")
    return {
      ...base,
      kind: "skill",
      titleKey: "skill_activated",
      titleArgs: { name: payload.name || "Skill" },
      detail: payload.scope,
    };
  if (type === "skill.updated")
    return {
      ...base,
      kind: "skill",
      titleKey: "skill_updated",
      titleArgs: { name: payload.name || "Skill" },
      detail: payload.scope,
    };
  if (type === "skill.resource.used")
    return {
      ...base,
      kind: "skill",
      titleKey: "skill_resource_used",
      titleArgs: { name: payload.name || "Skill" },
      detail: payload.path,
    };
  if (type === "skill.script.executed")
    return {
      ...base,
      kind: "skill",
      titleKey: "skill_script_executed",
      titleArgs: { name: payload.name || "Skill" },
      detail: payload.path || payload.language,
    };
  if (type === "context.memory.recalled") {
    const memories = Array.isArray(payload.memories) ? payload.memories : [];
    return {
      ...base,
      kind: "memory",
      titleKey: "memory_recalled",
      titleArgs: { count: Number(payload.count) || 0 },
      count: Number(payload.count) || 0,
      scopes: [...new Set(memories.map((item) => item.scope).filter(Boolean))],
    };
  }
  if (type === "context.memory.updated") {
    const action = payload.action || "stored";
    return {
      ...base,
      kind: action === "deleted" ? "memory-delete" : "memory-store",
      titleKey: action === "deleted" ? "memory_deleted" : "memory_updated",
      titleArgs: { count: Number(payload.count) || 1 },
      count: Number(payload.count) || 1,
      scopes: payload.scope ? [payload.scope] : [],
    };
  }
  if (type === "context.rag.recalled") {
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    return {
      ...base,
      kind: "rag",
      titleKey: "rag_recalled",
      titleArgs: { count: Number(payload.count) || 0 },
      count: Number(payload.count) || 0,
      items: sources
        .map((source) => source?.title || source?.sourceDocument)
        .filter(Boolean)
        .slice(0, 3),
    };
  }
  return null;
}

function activityFromEvent(event) {
  const { type, payload = {} } = event;
  const base = {
    id: event.id ?? `${type}:${event.createdAt || Date.now()}`,
    createdAt: event.createdAt,
    phase: payload.phase,
    requestId: payload.requestId,
  };
  if (type === "run.started") return { ...base, summaryKey: "agent_started" };
  if (type === "input.resolved") return { ...base, summaryKey: "restoring" };
  if (type === "activity.updated")
    return {
      ...base,
      summary: payload.summary,
      summaryKey: payload.summaryKey,
      summaryArgs: payload.summaryArgs,
    };
  if (type === "plan.created")
    return {
      ...base,
      summaryKey: "plan_ready",
      summaryArgs: { count: payload.tasks?.length || 0 },
    };
  if (type === "task.started")
    return {
      ...base,
      summaryKey: "task_started",
      summaryArgs: { task: payload.title || payload.taskId },
    };
  if (type === "task.progress" && payload.summary)
    return { ...base, summary: payload.summary };
  if (["task.completed", "task.failed", "task.retrying"].includes(type))
    return {
      ...base,
      summaryKey: type.replace(".", "_"),
      summaryArgs: {
        task:
          payload.result?.title ||
          payload.result?.summary ||
          payload.title ||
          payload.taskId,
      },
    };
  if (type.startsWith("tool.") && payload.toolId)
    return {
      ...base,
      summary:
        type === "tool.skipped" ||
        (type === "tool.failed" && payload.code === "NO_PROGRESS")
          ? payload.reason || payload.error || payload.summary
          : null,
      summaryKey:
        type === "tool.skipped" ||
        (type === "tool.failed" && payload.code === "NO_PROGRESS")
          ? null
          : ["tool.completed", "tool.failed"].includes(type)
            ? type.replace(".", "_")
            : "tool_started",
      summaryArgs: { tool: payload.toolId },
    };
  if (
    ["run.completed", "run.partial", "run.failed", "run.cancelled"].includes(
      type
    )
  )
    return {
      ...base,
      summaryKey:
        type === "run.failed" && payload.error
          ? "run_failed_with_error"
          : type.replace(".", "_"),
      summaryArgs: payload.error ? { error: payload.error } : null,
    };
  return null;
}

function appendActivity(activities, activity) {
  if (!activity || (!activity.summary && !activity.summaryKey))
    return activities;
  const previous = activities.at(-1);
  const fingerprint = JSON.stringify([
    activity.summaryKey,
    activity.summary,
    activity.summaryArgs,
  ]);
  const previousFingerprint = previous
    ? JSON.stringify([
        previous.summaryKey,
        previous.summary,
        previous.summaryArgs,
      ])
    : null;
  if (fingerprint === previousFingerprint)
    return [...activities.slice(0, -1), activity];
  return [...activities, activity].slice(-MAX_AGENT_ACTIVITIES);
}

function appendTextPart(parts, partId, delta) {
  if (!partId || !delta) return parts;
  const next = parts.map((part) => ({
    ...part,
    ...(Array.isArray(part.callIds) ? { callIds: [...part.callIds] } : {}),
  }));
  const index = next.findIndex(
    (part) => part.id === partId && part.type === "text"
  );
  if (index >= 0)
    next[index] = { ...next[index], text: `${next[index].text || ""}${delta}` };
  else next.push({ id: partId, type: "text", text: String(delta) });
  return next;
}

function appendToolGroupCall(parts, groupId, callId) {
  if (!groupId || !callId) return parts;
  const next = parts.map((part) => ({
    ...part,
    ...(Array.isArray(part.callIds) ? { callIds: [...part.callIds] } : {}),
  }));
  const index = next.findIndex(
    (part) => part.id === groupId && part.type === "toolGroup"
  );
  if (index < 0) {
    next.push({ id: groupId, type: "toolGroup", callIds: [callId] });
    return next;
  }
  if (!next[index].callIds.includes(callId)) next[index].callIds.push(callId);
  return next;
}

function updateExecutionState(history, runId, event) {
  if (!runId || !event) return history;
  return history.map((entry) =>
    entry.type === "agentExecution" && entry.agentRunId === runId
      ? {
          ...entry,
          agentRunState: reduceAgentRunState(entry.agentRunState, event),
        }
      : entry
  );
}

export function reduceAgentRunState(state, event) {
  const next = {
    runId: state?.runId,
    status: state?.status || "queued",
    phase: state?.phase || "queued",
    summary: state?.summary || "Preparing the request",
    summaryKey: state?.summaryKey || "preparing",
    summaryArgs: state?.summaryArgs || null,
    agent: state?.agent || null,
    runtimeKey: state?.runtimeKey || null,
    startedAt: state?.startedAt || event.createdAt,
    completedAt: state?.completedAt || null,
    tasks: [...(state?.tasks || [])],
    evidence: [...(state?.evidence || [])],
    toolExecutions: [...(state?.toolExecutions || [])],
    activities: [...(state?.activities || [])],
    resourceTraces: [...(state?.resourceTraces || [])],
    messageParts: [...(state?.messageParts || [])],
  };
  const { type, payload = {} } = event;
  if (type === "activity.updated") {
    next.phase = payload.phase || next.phase;
    next.summary = payload.summary || next.summary;
    next.summaryKey = payload.summaryKey || null;
    next.summaryArgs = payload.summaryArgs || null;
  }
  if (type === "run.started") {
    next.status = "running";
    next.phase = "running";
    next.agent = payload.agent || next.agent;
    next.runtimeKey = payload.runtime?.key || next.runtimeKey;
    next.startedAt = event.createdAt;
  }
  if (type === "input.requested") {
    next.status = "waiting_for_input";
    next.phase = "input";
  }
  if (type === "input.resolved") {
    next.status = "queued";
    next.phase = "resuming";
    next.summary = "正在恢复 Agent 工作";
    next.summaryKey = "restoring";
    next.summaryArgs = null;
    next.activities = next.activities.filter(
      (activity) =>
        activity.phase !== "input" ||
        (activity.requestId && activity.requestId !== payload.requestId)
    );
  }
  if (
    ["run.completed", "run.partial", "run.failed", "run.cancelled"].includes(
      type
    )
  ) {
    next.status = type.slice("run.".length);
    next.phase = "complete";
    next.completedAt = event.createdAt;
    next.summary =
      type === "run.partial"
        ? "Finished with partial results"
        : type === "run.failed"
          ? payload.error || "Agent work failed"
          : type === "run.cancelled"
            ? "Agent work cancelled"
            : "Agent work complete";
    next.summaryKey =
      type === "run.failed" && payload.error
        ? "run_failed_with_error"
        : type.replace(".", "_");
    next.summaryArgs = payload.error ? { error: payload.error } : null;
    const unfinishedStatus = type === "run.failed" ? "failed" : "cancelled";
    const unfinishedError =
      payload.error || "The run ended before this operation completed.";
    next.tasks = next.tasks.map((task) =>
      ["pending", "queued", "running", "retrying"].includes(task.status)
        ? { ...task, status: unfinishedStatus, error: unfinishedError }
        : task
    );
    next.toolExecutions = next.toolExecutions.map((execution) =>
      ["requested", "running", "started", "retrying"].includes(execution.status)
        ? {
            ...execution,
            status: unfinishedStatus,
            error: unfinishedError,
          }
        : execution
    );
  }
  if (
    ["plan.created", "plan.updated"].includes(type) &&
    Array.isArray(payload.tasks)
  ) {
    const previous = new Map(next.tasks.map((task) => [task.id, task]));
    next.tasks = payload.tasks.map((task) => ({
      ...previous.get(task.id),
      ...task,
      status: previous.get(task.id)?.status || task.status || "pending",
    }));
  }
  if (type === "task.created" && payload.task) {
    const index = next.tasks.findIndex((task) => task.id === payload.task.id);
    const task = { status: "pending", ...payload.task };
    if (index >= 0) next.tasks[index] = { ...next.tasks[index], ...task };
    else next.tasks.push(task);
  }
  if (type.startsWith("task.") && payload.taskId) {
    const index = next.tasks.findIndex((task) => task.id === payload.taskId);
    const existing = index >= 0 ? next.tasks[index] : { id: payload.taskId };
    const status =
      type === "task.started"
        ? "running"
        : type === "task.progress"
          ? existing.status || "running"
          : type.slice("task.".length);
    const updated = {
      ...existing,
      ...(payload.result || {}),
      status,
      agent: payload.agent || payload.result?.agent || existing.agent,
      progress: type === "task.progress" ? payload.summary : existing.progress,
      error: payload.error || existing.error,
      attempt: payload.attempt || existing.attempt,
    };
    if (index >= 0) next.tasks[index] = updated;
    else next.tasks.push(updated);
    if (type === "task.progress")
      next.summary = payload.summary || next.summary;
    if (type === "task.progress" && payload.summary) {
      next.summaryKey = null;
      next.summaryArgs = null;
    }
  }
  if (type.startsWith("tool.") && payload.callId) {
    const index = next.toolExecutions.findIndex(
      (item) => item.call_id === payload.callId
    );
    const status =
      type === "tool.failed" && payload.code === "NO_PROGRESS"
        ? "skipped"
        : type.slice("tool.".length);
    const execution = {
      ...(index >= 0 ? next.toolExecutions[index] : {}),
      call_id: payload.callId,
      task_id: payload.taskId,
      tool_id: payload.toolId,
      status,
      result_summary: payload.summary,
      error: status === "skipped" ? null : payload.error,
    };
    if (index >= 0) next.toolExecutions[index] = execution;
    else next.toolExecutions.push(execution);
    next.messageParts = appendToolGroupCall(
      next.messageParts,
      payload.groupId,
      payload.callId
    );
  }
  if (type === "message.delta" && payload.partId) {
    next.messageParts = appendTextPart(
      next.messageParts,
      payload.partId,
      payload.partDelta ?? payload.delta
    );
  }
  if (type === "message.completed" && Array.isArray(payload.parts)) {
    next.messageParts = payload.parts;
  }
  if (type === "context.used" && Array.isArray(payload.items)) {
    for (const item of payload.items) {
      if (!next.evidence.some((existing) => existing.id === item.id))
        next.evidence.push({ ...item, task_id: payload.taskId || null });
    }
  }
  if (type.startsWith("subagent.") && payload.childRunId) {
    const id = `subagent:${payload.childRunId}`;
    const index = next.tasks.findIndex((task) => task.id === id);
    const task = {
      ...(index >= 0 ? next.tasks[index] : {}),
      id,
      title: payload.task || payload.agent?.name || "Delegated Agent task",
      objective: payload.task,
      agent: payload.agent,
      status: type.slice("subagent.".length),
      resultSummary: payload.response,
      error: payload.error,
    };
    if (index >= 0) next.tasks[index] = task;
    else next.tasks.push(task);
  }
  next.resourceTraces = appendResourceTrace(
    next.resourceTraces,
    resourceTraceFromEvent(event)
  );
  next.activities = appendActivity(next.activities, activityFromEvent(event));
  return next;
}

export function createAgentSSETransport(uuid) {
  return new AgentSSETransport(uuid);
}

export default function handleSocketResponse(socket, event, setChatHistory) {
  let data = safeJsonParse(event.data, null);
  if (data === null) return;
  data = legacyEventFromAgentRun(data);
  if (data === null) return;

  if (data.type === "agentRunEvent") {
    const { runId, event: runEvent } = data.content || {};
    if (!runId || !runEvent) return;
    return setChatHistory((prev) => {
      const uuid = `${runId}:execution`;
      const index = prev.findIndex((message) => message.uuid === uuid);
      const current = index >= 0 ? prev[index].agentRunState : { runId };
      const agentRunState = reduceAgentRunState(current, runEvent);
      const message = {
        uuid,
        type: "agentExecution",
        content: agentRunState.summary,
        agentRunId: runId,
        agentRunState,
        role: "assistant",
        closed: ["completed", "partial", "failed", "cancelled"].includes(
          agentRunState.status
        ),
        animate: false,
        pending: !["completed", "partial", "failed", "cancelled"].includes(
          agentRunState.status
        ),
        sources: [],
        metrics: {},
      };
      const next =
        index >= 0
          ? prev.map((entry, entryIndex) =>
              entryIndex === index ? message : entry
            )
          : [...prev.filter((entry) => !!entry.content), message];
      if (runEvent.type === "input.requested") {
        if (
          next.some(
            (entry) =>
              entry.type === "clarifyingQuestion" &&
              entry.requestId === runEvent.payload?.requestId
          )
        )
          return next;
        return [
          ...next,
          {
            uuid: `${runId}:clarification:${runEvent.payload?.requestId}`,
            type: "clarifyingQuestion",
            requestId: runEvent.payload?.requestId,
            questions: runEvent.payload?.questions || [],
            allowSkip: runEvent.payload?.allowSkip !== false,
            timeoutMs: runEvent.payload?.timeoutMs,
            content: "需要补充信息",
            role: "assistant",
            sources: [],
            closed: false,
            error: null,
            animate: false,
            pending: true,
            metrics: {},
          },
        ];
      }
      if (runEvent.type === "input.resolved") {
        return next.map((entry) =>
          entry.type === "clarifyingQuestion" &&
          entry.requestId === runEvent.payload?.requestId
            ? {
                ...entry,
                resolved: true,
                resolution: {
                  skipped: Boolean(runEvent.payload?.skipped),
                  ...(Array.isArray(runEvent.payload?.answers)
                    ? { answers: runEvent.payload.answers }
                    : { resolved: true }),
                },
                closed: true,
                pending: false,
              }
            : entry
        );
      }
      if (["run.completed", "run.partial"].includes(runEvent.type)) {
        return next.map((entry) =>
          entry.uuid === `${runId}:assistant`
            ? {
                ...entry,
                ...(runEvent.payload?.sources?.length
                  ? { sources: runEvent.payload.sources }
                  : {}),
                ...(runEvent.payload?.outputs?.length
                  ? { outputs: runEvent.payload.outputs }
                  : {}),
              }
            : entry
        );
      }
      return next;
    });
  }

  // A server-owned lifecycle status is updated in place so there is always one
  // concise line describing the active operation. Detailed statusResponse
  // events remain available as the expandable working trace.
  if (data.type === "agentStatus") {
    const status = data.content || {};
    if (!status.uuid || !status.summary) return;
    const terminalStatus =
      status.active === false ||
      ["finalizing", "completed"].includes(status.phase);
    if (terminalStatus) {
      return setChatHistory((prev) =>
        prev.filter((msg) => msg.type !== "agentStatus")
      );
    }
    return setChatHistory((prev) => [
      ...prev.filter((msg) => msg.type !== "agentStatus"),
      {
        uuid: status.uuid,
        type: "agentStatus",
        content: status.summary,
        phase: status.phase || "working",
        active: status.active !== false,
        role: "assistant",
        sources: [],
        closed: status.active === false,
        error: null,
        animate: status.active !== false,
        pending: status.active !== false,
        metrics: {},
      },
    ]);
  }

  // Handle thread rename
  if (data.type === "rename_thread") {
    const { slug, name } = data.content || {};
    if (slug && name) {
      window.dispatchEvent(
        new CustomEvent(THREAD_RENAME_EVENT, {
          detail: { threadSlug: slug, newName: name },
        })
      );
    }
    return;
  }

  // No message type is defined then this is a generic message
  // that we need to print to the user as a system response
  if (!data.hasOwnProperty("type") && !socket.supportsAgentStreaming) {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: {},
        },
      ];
    });
  }

  // toolApprovalRequest doesn't have content field, so check separately
  if (data.type === "toolApprovalRequest") {
    if (!data.requestId || !data.skillName) return;
  } else if (data.type === "clarificationRequest") {
    if (!data.requestId || !Array.isArray(data.questions)) return;
  } else if (!handledEvents.includes(data.type) || !data.content) {
    return;
  }

  if (data.type === "reportStreamEvent") {
    // Enable agent streaming for the next message so we can handle streaming or non-streaming responses
    // If we get this message we know the provider supports agentic streaming
    socket.supportsAgentStreaming = true;

    // trigger TTS auto-play
    if (data.content?.type === "chatId" && data.content?.chatId)
      emitAssistantMessageCompleteEvent(data.content.chatId);

    return setChatHistory((prev) => {
      const withAgentState = (history) =>
        updateExecutionState(
          history,
          data.content.agentRunId,
          data.content.agentRunEvent
        );
      if (data.content.type === "removeStatusResponse")
        return [...prev.filter((msg) => msg.uuid !== data.content.uuid)];

      if (data.content.type === "modelRouteNotification") {
        if (!data.content.routedTo) return prev;
        return [
          ...prev.filter(
            (msg) => !(msg.role === "assistant" && msg.pending && !msg.content)
          ),
          {
            uuid: data.content.uuid,
            type: "modelRouteNotification",
            content: "modelRouteNotification",
            routedTo: data.content.routedTo,
          },
        ];
      }

      if (data.content.type === "subagentEvent") {
        const { uuid, run } = data.content;
        if (!uuid || !run) return prev;
        const message = {
          uuid,
          type: "subagentRun",
          content: run.task || run.agent?.name || "Subagent",
          subagentRun: run,
          role: "assistant",
          sources: [],
          closed: run.status !== "running",
          error: run.error || null,
          animate: run.status === "running",
          pending: run.status === "running",
          metrics: {},
        };
        return prev.some((entry) => entry.uuid === uuid)
          ? prev.map((entry) => (entry.uuid === uuid ? message : entry))
          : [...prev.filter((entry) => !!entry.content), message];
      }

      if (data.content.type === "contextTrace") {
        const { uuid, trace } = data.content;
        if (!uuid || !trace) return prev;
        const message = {
          uuid,
          type: "contextTrace",
          content: trace.title || "Context used",
          contextTrace: trace,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: {},
        };
        return prev.some((entry) => entry.uuid === uuid)
          ? prev.map((entry) => (entry.uuid === uuid ? message : entry))
          : [...prev.filter((entry) => !!entry.content), message];
      }

      // Handle citations independently of message creation order. If the target message
      // exists, attach now or buffer until it is created.
      if (data.content.type === "citations") {
        const { uuid, citations } = data.content;
        if (!citations) return prev;
        let attached = false;
        const next = prev.map((msg) => {
          if (msg.uuid !== uuid) return msg;
          attached = true;
          return { ...msg, sources: [...(msg.sources || []), ...citations] };
        });
        if (!attached) bufferedCitations.set(uuid, citations);
        return next;
      }

      const knownMessage = data.content.uuid
        ? prev.find((msg) => msg.uuid === data.content.uuid)
        : null;
      if (!knownMessage) {
        if (data.content.type === "fullTextResponse") {
          return withAgentState([
            ...prev.filter((msg) => !!msg.content),
            {
              uuid: data.content.uuid,
              type: "textResponse",
              content: data.content.content,
              role: "assistant",
              sources: takeBufferedCitations(data.content.uuid),
              closed: true,
              error: null,
              animate: false,
              pending: false,
              metrics: {},
            },
          ]);
        }

        // Handle textResponseChunk initialization as textResponse instead of statusResponse.
        // Without this the first chunk creates a statusResponse (thought bubble) by falling through to the default case.
        // Providers like Gemini send large chunks and can complete in a single chunk before the update logic can convert it.
        // Other providers send many small chunks so the second chunk triggers the update logic to fix the type.
        if (data.content.type === "textResponseChunk") {
          // If this first chunk is just a non-text char (like \n, \t, etc.) then we need to ignore it.
          // Some providers like LMStudio will do this and it depends on the chat template as well.
          if (data.content.content.trim() === "") return prev;
          return withAgentState([
            ...prev.filter((msg) => !!msg.content),
            {
              uuid: data.content.uuid,
              type: "textResponse",
              content: data.content.content,
              role: "assistant",
              sources: takeBufferedCitations(data.content.uuid),
              closed: true,
              error: null,
              animate: false,
              pending: false,
              metrics: {},
              agentRunId: data.content.agentRunId,
            },
          ]);
        }

        return [
          ...prev.filter((msg) => !!msg.content),
          {
            uuid: data.content.uuid,
            type: "statusResponse",
            content: data.content.content,
            role: "assistant",
            sources: [],
            closed: true,
            error: null,
            animate: false,
            pending: false,
            metrics: {},
          },
        ];
      } else {
        const { type, content, uuid } = data.content;
        // For tool call invocations, we need to update the existing message entirely since it is accumulated
        // and we dont know if the function will have arguments or not while streaming - so replace the existing message entirely
        if (type === "toolCallInvocation") {
          const knownMessage = prev.find((msg) => msg.uuid === uuid);
          if (!knownMessage)
            return [...prev, { uuid, type: "toolCallInvocation", content }]; // If the message is not known, add it to the end of the list
          return [
            ...prev.filter((msg) => msg.uuid !== uuid),
            { ...knownMessage, content },
          ]; // If the message is known, replace it with the new content
        }

        if (type === "usageMetrics") {
          if (!data.content.metrics) return prev;
          return prev.map((msg) =>
            msg.uuid === uuid ? { ...msg, metrics: data.content.metrics } : msg
          );
        }

        if (type === "chatId") {
          if (!data.content.chatId) return prev;
          const assistantIdx = prev.findIndex((msg) => msg.uuid === uuid);
          if (assistantIdx === -1) return prev;
          const userIdx = prev.findLastIndex(
            (msg, i) => i < assistantIdx && msg.role === "user"
          );
          const turnTraces = prev
            .slice(userIdx + 1)
            .filter((msg) => msg.type === "contextTrace" && msg.contextTrace)
            .map((msg) => msg.contextTrace);
          return withAgentState(
            prev
              .filter((msg, i) => !(i > userIdx && msg.type === "contextTrace"))
              .map((msg) => {
                if (msg.uuid === uuid) {
                  const existing = Array.isArray(msg.contextTraces)
                    ? msg.contextTraces
                    : [];
                  const seen = new Set(existing.map((trace) => trace.id));
                  return {
                    ...msg,
                    chatId: data.content.chatId,
                    ...(Array.isArray(data.content.parts)
                      ? { messageParts: data.content.parts }
                      : {}),
                    contextTraces: [
                      ...existing,
                      ...turnTraces.filter((trace) => !seen.has(trace.id)),
                    ],
                  };
                }
                if (msg === prev[userIdx])
                  return { ...msg, chatId: data.content.chatId };
                return msg;
              })
          );
        }

        if (type === "textResponseChunk") {
          return withAgentState(
            prev
              .map((msg) =>
                msg.uuid === uuid
                  ? {
                      ...msg,
                      type: "textResponse",
                      content: msg.content + content,
                      agentRunId:
                        data.content.agentRunId || msg.agentRunId || null,
                    }
                  : msg?.content
                    ? msg
                    : null
              )
              .filter((msg) => !!msg)
          );
        }

        // Generic text response - will be put in the agent thought bubble
        return prev.map((msg) =>
          msg.uuid === data.content.uuid
            ? { ...msg, content: msg.content + data.content.content }
            : msg
        );
      }
    });
  }

  if (data.type === "fileDownloadCard") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          type: "fileDownloadCard",
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: data.metrics || {},
        },
      ];
    });
  }

  if (data.type === "scheduledJobCreated") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          type: "scheduledJobCreated",
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: data.metrics || {},
        },
      ];
    });
  }

  if (data.type === "rechartVisualize") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          type: "rechartVisualize",
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: data.metrics || {},
        },
      ];
    });
  }

  if (data.type === "wssFailure") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: data.content,
          animate: false,
          pending: false,
          metrics: {},
        },
      ];
    });
  }

  if (data.type === "toolApprovalRequest") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          type: "toolApprovalRequest",
          requestId: data.requestId,
          skillName: data.skillName,
          payload: data.payload,
          description: data.description,
          timeoutMs: data.timeoutMs,
          content: `Approval requested for ${data.skillName}`,
          role: "assistant",
          sources: [],
          closed: false,
          error: null,
          animate: false,
          pending: true,
          metrics: {},
        },
      ];
    });
  }

  if (data.type === "clarificationRequest") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          type: "clarifyingQuestion",
          requestId: data.requestId,
          questions: data.questions || [],
          allowSkip: data.allowSkip !== false,
          timeoutMs: data.timeoutMs,
          content: `Agent has ${data.questions?.length || 0} question${
            (data.questions?.length || 0) === 1 ? "" : "s"
          }`,
          role: "assistant",
          sources: [],
          closed: false,
          error: null,
          animate: false,
          pending: true,
          metrics: {},
        },
      ];
    });
  }

  return setChatHistory((prev) => {
    return [
      ...prev.filter((msg) => !!msg.content),
      {
        uuid: v4(),
        type: data.type,
        content: data.content,
        role: "assistant",
        sources: [],
        closed: true,
        error: null,
        animate: data?.animate || false,
        pending: false,
        metrics: data.metrics || {},
      },
    ];
  });
}

let _agentSessionActive = false;
export function setAgentSessionActive(value) {
  _agentSessionActive = value;
}
export function getAgentSessionActive() {
  return _agentSessionActive;
}

// Live agent-session websocket, used to toggle tools available to the agent mid-session.
let _agentSessionSocket = null;
export function setAgentSessionSocket(socket) {
  _agentSessionSocket = socket;
}

/**
 * Toggle a tool/skill on or off for the active agent session over the websocket.
 * No-op when there is no open agent session.
 * @param {string} skill - Skill key, MCP `<server>-<tool>`, hubId, or sub-skill name.
 * @param {boolean} enabled - Whether the tool should be enabled.
 * @param {string|null} [serverName] - MCP server name; required to enable an MCP tool mid-session.
 */
export function toggleAgentSessionTool(skill, enabled, serverName = null) {
  if (_agentSessionSocket?.readyState !== WebSocket.OPEN) return;
  _agentSessionSocket.send(
    JSON.stringify({ type: "agentToolToggle", skill, enabled, serverName })
  );
}

export function useIsAgentSessionActive() {
  const [activeSession, setActiveSession] = useState(
    () => !!getAgentSessionActive()
  );
  useEffect(() => {
    const handleSessionStart = () => setActiveSession(true);
    const handleSessionEnd = () => setActiveSession(false);
    window.addEventListener(AGENT_SESSION_START, handleSessionStart);
    window.addEventListener(AGENT_SESSION_END, handleSessionEnd);
    return () => {
      window.removeEventListener(AGENT_SESSION_START, handleSessionStart);
      window.removeEventListener(AGENT_SESSION_END, handleSessionEnd);
    };
  }, []);

  return activeSession;
}
