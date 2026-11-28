import { appendResourceTrace } from "./agentResourceTraces.ts";
import type {
  Activity,
  AgentRunEvent,
  AgentRunState,
  MessagePart,
  RunPayload,
} from "./agentRunTypes.ts";

const MAX_AGENT_ACTIVITIES = 24;

function resourceTraceFromEvent(event: AgentRunEvent) {
  const { type } = event;
  const payload: RunPayload = event.payload ?? {};
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

function activityFromEvent(event: AgentRunEvent): Activity | null {
  const { type } = event;
  const payload: RunPayload = event.payload ?? {};
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

function appendActivity(activities: Activity[], activity: Activity | null) {
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

function appendTextPart(parts: MessagePart[], partId?: string, delta?: string) {
  if (!partId || !delta) return parts;
  const next = [...parts];
  const index = next.findIndex(
    (part) => part.id === partId && part.type === "text"
  );
  if (index >= 0)
    next[index] = { ...next[index], text: `${next[index].text || ""}${delta}` };
  else next.push({ id: partId, type: "text", text: String(delta) });
  return next;
}

function appendToolGroupCall(
  parts: MessagePart[],
  groupId?: string,
  callId?: string
) {
  if (!groupId || !callId) return parts;
  const next = [...parts];
  const index = next.findIndex(
    (part) => part.id === groupId && part.type === "toolGroup"
  );
  if (index < 0) {
    next.push({ id: groupId, type: "toolGroup", callIds: [callId] });
    return next;
  }
  const calls = next[index].callIds ?? [];
  if (!calls.includes(callId))
    next[index] = { ...next[index], callIds: [...calls, callId] };
  return next;
}

export function reduceAgentRunState(
  state: Partial<AgentRunState> | null | undefined,
  event: AgentRunEvent
): AgentRunState {
  const next: AgentRunState = {
    runId: state?.runId ?? event.runId,
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
    outputs: state?.outputs || [],
  };
  const { type } = event;
  const payload: RunPayload = event.payload ?? {};
  if (Array.isArray(payload.outputs)) next.outputs = payload.outputs;
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
      ["pending", "queued", "running", "retrying"].includes(task.status || "")
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
      status:
        payload.planKind === "progress"
          ? task.status || "pending"
          : previous.get(task.id)?.status || task.status || "pending",
    }));
  }
  if (
    type === "task.created" &&
    typeof payload.task === "object" &&
    payload.task
  ) {
    const { id } = payload.task;
    const index = next.tasks.findIndex((task) => task.id === id);
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
      startedAt:
        (index >= 0 ? next.toolExecutions[index].startedAt : null) ||
        event.createdAt,
      completedAt: ["completed", "failed", "cancelled", "skipped"].includes(
        status
      )
        ? event.createdAt
        : null,
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
      title:
        (typeof payload.task === "string" && payload.task) ||
        payload.agent?.name ||
        "Delegated Agent task",
      objective:
        typeof payload.task === "string" ? payload.task : payload.task?.title,
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
