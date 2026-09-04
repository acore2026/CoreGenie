import { useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  Clock,
  ClockCountdown,
  GitBranch,
  MinusCircle,
  StopCircle,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { v4 } from "uuid";
import { useTranslation } from "react-i18next";
import { reduceAgentRunState } from "@/utils/chat/agent";
import ContextTrace from "../ContextTrace";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);
const ACTIVE_TOOL_STATUSES = new Set([
  "requested",
  "running",
  "started",
  "retrying",
]);

const statusMeta = {
  completed: {
    Icon: CheckCircle,
    labelKey: "completed",
    tone: "text-emerald-400 light:text-emerald-700",
  },
  running: {
    Icon: CircleNotch,
    labelKey: "running",
    tone: "text-cyan-300 light:text-cyan-700",
  },
  pending: {
    Icon: ClockCountdown,
    labelKey: "pending",
    tone: "text-amber-300 light:text-amber-700",
  },
  planned: {
    Icon: ClockCountdown,
    labelKey: "planned",
    tone: "text-amber-300 light:text-amber-700",
  },
  queued: {
    Icon: ClockCountdown,
    labelKey: "queued",
    tone: "text-amber-300 light:text-amber-700",
  },
  retrying: {
    Icon: Clock,
    labelKey: "retrying",
    tone: "text-amber-300 light:text-amber-700",
  },
  waiting_for_input: {
    Icon: Clock,
    labelKey: "waiting_for_input",
    tone: "text-amber-300 light:text-amber-700",
  },
  waiting_for_approval: {
    Icon: Clock,
    labelKey: "waiting_for_approval",
    tone: "text-amber-300 light:text-amber-700",
  },
  failed: {
    Icon: WarningCircle,
    labelKey: "failed",
    tone: "text-red-400 light:text-red-700",
  },
  cancelled: {
    Icon: XCircle,
    labelKey: "cancelled",
    tone: "text-zinc-500 light:text-slate-500",
  },
  skipped: {
    Icon: MinusCircle,
    labelKey: "skipped",
    tone: "text-zinc-500 light:text-slate-500",
  },
  partial: {
    Icon: WarningCircle,
    labelKey: "partial",
    tone: "text-amber-300 light:text-amber-700",
  },
};

function metaFor(status) {
  return statusMeta[status] || statusMeta.pending;
}

function elapsed(startedAt, completedAt, now) {
  if (!startedAt) return null;
  const end = completedAt ? new Date(completedAt).getTime() : now;
  const seconds = Math.max(
    0,
    Math.round((end - new Date(startedAt).getTime()) / 1_000)
  );
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function toolName(toolId) {
  const value = String(toolId || "Tool");
  const segment = value.split(/[.:/]/).filter(Boolean).at(-1) || value;
  return segment.replace(/[-_]+/g, " ");
}

function localizedActivity(activity, t) {
  if (!activity) return "";
  if (activity.summaryKey)
    return t(
      `chat_window.agent_invocation.activity.${activity.summaryKey}`,
      activity.summaryArgs || {}
    );
  const summary = String(activity.summary || "");
  const determiningPrefix = "Determining the best approach for ";
  if (summary.startsWith(determiningPrefix))
    return t("chat_window.agent_invocation.activity.determining_approach", {
      request: summary.slice(determiningPrefix.length),
    });
  const understandingPrefix = "Understanding: ";
  if (summary.startsWith(understandingPrefix))
    return t("chat_window.agent_invocation.activity.understanding", {
      request: summary.slice(understandingPrefix.length),
    });
  return summary;
}

function ToolExecutionRow({ tool, t }) {
  const status = tool.status || "requested";
  const active = ACTIVE_TOOL_STATUSES.has(status);
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const skipped = status === "skipped";
  const Icon = active
    ? CircleNotch
    : failed
      ? WarningCircle
      : cancelled
        ? MinusCircle
        : skipped
          ? MinusCircle
          : CheckCircle;
  const tone = active
    ? "text-cyan-300 light:text-cyan-700"
    : failed
      ? "text-amber-300 light:text-amber-700"
      : cancelled
        ? "text-zinc-500 light:text-slate-500"
        : skipped
          ? "text-zinc-500 light:text-slate-500"
          : "text-emerald-400 light:text-emerald-700";
  const detail = tool.error || tool.result_summary;

  return (
    <li className="grid min-h-9 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1 py-1.5">
      <Icon
        size={14}
        weight={active ? "regular" : "fill"}
        className={`mt-0.5 ${tone} ${active ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`}
      />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-theme-text-primary">
          {toolName(tool.tool_id)}
        </span>
        {detail && (
          <span
            className={`mt-0.5 block truncate text-[11px] leading-4 ${failed ? "text-amber-300 light:text-amber-700" : "text-theme-text-secondary"}`}
          >
            {detail}
          </span>
        )}
      </span>
      <span className={`pt-0.5 text-[10px] font-semibold capitalize ${tone}`}>
        {t(
          `chat_window.agent_invocation.status.${active ? "running" : status}`
        )}
      </span>
    </li>
  );
}

function stateFromSnapshot(snapshot) {
  if (!snapshot?.run) return null;
  const fallbackSummary =
    snapshot.run.status === "partial"
      ? "Finished with partial results"
      : TERMINAL.has(snapshot.run.status)
        ? "Agent work complete"
        : "Restoring Agent work";
  const fallbackSummaryKey =
    snapshot.run.status === "partial"
      ? "run_partial"
      : TERMINAL.has(snapshot.run.status)
        ? `run_${snapshot.run.status}`
        : "restoring";
  const replayed = (snapshot.events || []).reduce(reduceAgentRunState, {
    runId: snapshot.run.id,
    status: snapshot.run.status,
    phase: snapshot.run.phase,
    summary: fallbackSummary,
    summaryKey: fallbackSummaryKey,
    agent: snapshot.run.runtimeSnapshot?.agent,
    runtimeKey: snapshot.run.runtimeKey,
    startedAt: snapshot.run.startedAt || snapshot.run.createdAt,
    completedAt: snapshot.run.completedAt,
    tasks: [],
    evidence: [],
    toolExecutions: [],
    activities: [],
    resourceTraces: [],
    messageParts: [],
  });
  return {
    ...replayed,
    status: snapshot.run.status,
    phase: snapshot.run.phase,
    agent: snapshot.run.runtimeSnapshot?.agent || replayed.agent,
    runtimeKey: snapshot.run.runtimeKey || replayed.runtimeKey,
    startedAt: snapshot.run.startedAt || snapshot.run.createdAt,
    completedAt: snapshot.run.completedAt,
    tasks: snapshot.tasks || [],
    evidence: snapshot.evidence || [],
    toolExecutions: snapshot.toolExecutions || [],
    activities:
      replayed.activities.length > 0
        ? replayed.activities
        : [
            {
              id: `${snapshot.run.id}:snapshot`,
              summaryKey: fallbackSummaryKey,
            },
          ],
  };
}

function TaskRow({ task, evidence, tools, onCommand, runActive, t }) {
  const [open, setOpen] = useState(false);
  const meta = metaFor(task.status);
  const Icon = meta.Icon;
  const taskEvidence = evidence.filter((item) => item.task_id === task.id);
  const taskTools = tools.filter((item) => item.task_id === task.id);
  const canStop =
    runActive && ["pending", "running", "retrying"].includes(task.status);

  return (
    <li className="relative pl-6 before:absolute before:bottom-[-8px] before:left-[7px] before:top-5 before:w-px before:bg-white/[0.07] last:before:hidden light:before:bg-slate-200">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group grid min-h-10 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1 py-1.5 text-left outline-none hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-cyan-400/60 light:hover:bg-slate-100"
        aria-expanded={open}
      >
        <Icon
          size={15}
          weight={task.status === "completed" ? "fill" : "regular"}
          className={`mt-0.5 ${meta.tone} ${task.status === "running" ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`}
        />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-semibold text-theme-text-primary">
              {task.title}
            </span>
            {task.agent?.name && (
              <span className="hidden min-w-0 items-center gap-1 text-[10px] text-theme-text-secondary sm:flex">
                <AgentAvatar
                  agent={task.agent}
                  size={14}
                  className="!rounded"
                />
                <span className="max-w-24 truncate">{task.agent.name}</span>
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-theme-text-secondary">
            {task.progress || task.resultSummary || task.objective}
          </span>
        </span>
        <span className="flex items-center gap-2 pt-0.5 font-mono text-[10px] tabular-nums text-theme-text-secondary">
          {taskTools.length > 0 && (
            <span>
              {t("chat_window.agent_invocation.tools_count", {
                count: taskTools.length,
              })}
            </span>
          )}
          {taskEvidence.length > 0 && (
            <span>
              {t("chat_window.agent_invocation.sources_count", {
                count: taskEvidence.length,
              })}
            </span>
          )}
          <CaretDown
            size={12}
            className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="mb-2 ml-6 border-l border-white/[0.07] py-1 pl-3 text-[11px] leading-5 text-theme-text-secondary light:border-slate-200">
          <p className="m-0 whitespace-pre-wrap text-theme-text-primary">
            {task.resultSummary || task.objective}
          </p>
          {task.error && (
            <p className="m-0 mt-1 text-red-400 light:text-red-700">
              {task.error}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[10px] tabular-nums">
            <span>
              {t(`chat_window.agent_invocation.status.${meta.labelKey}`)}
            </span>
            {task.attempt > 1 && (
              <span>
                {t("chat_window.agent_invocation.attempt", {
                  count: task.attempt,
                })}
              </span>
            )}
            {taskTools.length > 0 && (
              <span>
                {t("chat_window.agent_invocation.tool_calls_count", {
                  count: taskTools.length,
                })}
              </span>
            )}
            {taskEvidence.length > 0 && (
              <span>
                {t("chat_window.agent_invocation.evidence_count", {
                  count: taskEvidence.length,
                })}
              </span>
            )}
          </div>
          {canStop && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onCommand("task.cancel", task.id)}
                className="inline-flex min-h-8 items-center gap-1 rounded-md border border-red-400/20 px-2 text-[10px] font-semibold text-red-300 hover:bg-red-400/10 focus-visible:ring-2 focus-visible:ring-red-400/60 light:text-red-700"
              >
                <StopCircle size={13} />
                {t("chat_window.agent_invocation.cancel_task")}
              </button>
              {task.status === "pending" && (
                <button
                  type="button"
                  onClick={() => onCommand("task.skip", task.id)}
                  className="min-h-8 rounded-md border border-white/10 px-2 text-[10px] font-semibold text-theme-text-secondary hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-cyan-400/60 light:border-slate-200 light:hover:bg-slate-100"
                >
                  {t("chat_window.agent_invocation.batch_skip_this")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function AgentExecutionRail({
  runId,
  runState = null,
  transport = null,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(
    () => !!runState && !TERMINAL.has(runState.status)
  );
  const [expansionWasChosen, setExpansionWasChosen] = useState(false);
  const [contextTraceExpanded, setContextTraceExpanded] = useState(false);
  const [doneToolsExpanded, setDoneToolsExpanded] = useState(false);
  const [snapshotState, setSnapshotState] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const state = runState || snapshotState;

  useEffect(() => {
    if (runState || !runId) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/agent-runs/${runId}/snapshot?view=rail`, {
      headers: baseHeaders(),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((snapshot) => setSnapshotState(stateFromSnapshot(snapshot)))
      .catch(() => null);
    return () => controller.abort();
  }, [runId, runState]);

  useEffect(() => {
    if (!state || TERMINAL.has(state.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (!expansionWasChosen && state && !TERMINAL.has(state.status)) {
      setExpanded(true);
    }
  }, [expansionWasChosen, state]);

  const tasks = state?.tasks || [];
  const evidence = state?.evidence || [];
  const tools = state?.toolExecutions || [];
  const resourceTraces = state?.resourceTraces || [];
  const runningTools = tools.filter((tool) =>
    ACTIVE_TOOL_STATUSES.has(tool.status || "requested")
  );
  const doneTools = tools.filter(
    (tool) => !ACTIVE_TOOL_STATUSES.has(tool.status || "requested")
  );
  const doneToolsNeedAttention = doneTools.some((tool) =>
    ["failed", "cancelled"].includes(tool.status)
  );
  const completed = tasks.filter((task) => task.status === "completed").length;
  const runActive = state ? !TERMINAL.has(state.status) : false;
  const meta = metaFor(state?.status || "running");
  const MetaIcon = meta.Icon;
  const duration = elapsed(state?.startedAt, state?.completedAt, now);
  const recentActivities = (state?.activities || [])
    .filter(
      (activity) =>
        state?.status === "waiting_for_input" || activity.phase !== "input"
    )
    .slice(-3);
  const localizedSummary = localizedActivity(
    {
      summary: state?.summary,
      summaryKey: state?.summaryKey,
      summaryArgs: state?.summaryArgs,
    },
    t
  );
  const currentTask = useMemo(
    () =>
      [...tasks]
        .reverse()
        .find((task) => ["running", "retrying"].includes(task.status)),
    [tasks]
  );

  if (!state) return null;

  const sendCommand = (type, taskId = null) => {
    if (!transport || transport.readyState !== WebSocket.OPEN) return;
    transport.send(JSON.stringify({ type, taskId, commandId: v4() }));
  };

  return (
    <section
      className={`mb-3 w-full max-w-[780px] overflow-hidden rounded-lg border bg-theme-bg-container text-theme-text-primary ${runActive ? "border-cyan-400/25 shadow-[inset_3px_0_0_rgba(34,211,238,0.55)] light:border-cyan-600/30" : "border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] light:border-slate-200"}`}
      aria-label={t("chat_window.agent_invocation.execution_aria")}
    >
      <button
        type="button"
        onClick={() => {
          setExpansionWasChosen(true);
          setExpanded((value) => !value);
        }}
        className="grid min-h-[52px] w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left outline-none hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 light:hover:bg-slate-50"
        aria-expanded={expanded}
      >
        <span className="relative flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-black/10 light:border-slate-200 light:bg-white">
          {state.agent ? (
            <AgentAvatar agent={state.agent} size={22} className="!rounded" />
          ) : (
            <GitBranch size={15} className={meta.tone} />
          )}
          <MetaIcon
            size={12}
            weight={runActive ? "regular" : "fill"}
            className={`absolute -bottom-1 -right-1 rounded-full bg-theme-bg-container ${meta.tone} ${runActive ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`}
          />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-text-secondary">
            <span className={meta.tone}>
              {t(`chat_window.agent_invocation.status.${meta.labelKey}`)}
            </span>
            {state.agent?.name && (
              <span className="truncate">{state.agent.name}</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[13px] font-medium leading-4">
            {currentTask?.progress ||
              currentTask?.title ||
              localizedSummary ||
              t("chat_window.agent_invocation.activity.preparing")}
          </span>
        </span>
        <span className="flex items-center gap-2 font-mono tabular-nums text-theme-text-secondary">
          {duration && (
            <span
              className={`flex items-center gap-1 text-sm font-semibold ${runActive ? "text-cyan-200 light:text-cyan-800" : ""}`}
            >
              <Clock size={14} weight="bold" />
              {duration}
            </span>
          )}
          {tasks.length > 0 && (
            <span className="text-[10px]">
              {completed}/{tasks.length}
            </span>
          )}
          <CaretDown
            size={13}
            className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {expanded && (
        <div className="border-t border-white/[0.07] px-3 py-2.5 light:border-slate-200">
          {tasks.length > 0 && (
            <div>
              <p className="m-0 px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-text-secondary">
                {t("chat_window.agent_invocation.tasks")}
              </p>
              <ol className="m-0 space-y-1 p-0">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    evidence={evidence}
                    tools={tools}
                    onCommand={sendCommand}
                    runActive={runActive}
                    t={t}
                  />
                ))}
              </ol>
            </div>
          )}
          {recentActivities.length > 0 && (
            <div
              className={`px-1 ${tasks.length > 0 ? "mt-2 border-t border-white/[0.07] pt-2 light:border-slate-200" : ""}`}
            >
              <p className="m-0 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-text-secondary">
                {t("chat_window.agent_invocation.activity_trace")}
              </p>
              <ol className="m-0 flex min-h-[60px] flex-col justify-end gap-1 p-0">
                {recentActivities.map((activity, index) => {
                  const isCurrent = index === recentActivities.length - 1;
                  return (
                    <li
                      key={activity.id}
                      className={`grid min-h-4 grid-cols-[8px_minmax(0,1fr)] items-center gap-2 text-[11px] leading-4 transition-[opacity,color] duration-150 motion-reduce:transition-none ${
                        isCurrent
                          ? "text-theme-text-primary"
                          : index === recentActivities.length - 2
                            ? "text-theme-text-secondary opacity-75"
                            : "text-theme-text-secondary opacity-50"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isCurrent
                            ? "bg-cyan-300 light:bg-cyan-700"
                            : "bg-white/20 light:bg-slate-300"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {localizedActivity(activity, t)}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <span className="sr-only" aria-live="polite" aria-atomic="true">
                {localizedActivity(recentActivities.at(-1), t)}
              </span>
            </div>
          )}
          {resourceTraces.length > 0 && (
            <div
              className={`${tasks.length > 0 || recentActivities.length > 0 ? "mt-2 border-t border-white/[0.07] pt-1 light:border-slate-200" : ""}`}
            >
              <button
                type="button"
                onClick={() => setContextTraceExpanded((value) => !value)}
                className="flex min-h-9 w-full items-center justify-between rounded-md px-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-text-secondary outline-none hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-cyan-400/60 light:hover:bg-slate-100"
                aria-expanded={contextTraceExpanded}
              >
                <span>{t("chat_window.agent_invocation.context_trace")}</span>
                <span className="flex items-center gap-2 font-mono tabular-nums">
                  {resourceTraces.length}
                  <CaretDown
                    size={12}
                    className={`transition-transform duration-150 ${contextTraceExpanded ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {contextTraceExpanded && (
                <ol className="m-0 space-y-1 p-0">
                  {resourceTraces.map((trace) => (
                    <li key={trace.id}>
                      <ContextTrace trace={trace} compact />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {tools.length > 0 && (
            <div
              className={
                tasks.length > 0 ||
                recentActivities.length > 0 ||
                resourceTraces.length > 0
                  ? "mt-2 border-t border-white/[0.07] pt-2 light:border-slate-200"
                  : ""
              }
            >
              <p className="m-0 flex items-center justify-between px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-text-secondary">
                <span>{t("chat_window.agent_invocation.tool_calls")}</span>
                <span className="font-mono tabular-nums">{tools.length}</span>
              </p>
              {runningTools.length > 0 && (
                <div>
                  <p className="m-0 flex items-center justify-between px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-300 light:text-cyan-700">
                    <span>
                      {t("chat_window.agent_invocation.status.running")}
                    </span>
                    <span className="font-mono tabular-nums">
                      {runningTools.length}
                    </span>
                  </p>
                  <ol className="m-0 space-y-0.5 p-0">
                    {runningTools.map((tool) => (
                      <ToolExecutionRow
                        key={tool.call_id || tool.id}
                        tool={tool}
                        t={t}
                      />
                    ))}
                  </ol>
                </div>
              )}
              {doneTools.length > 0 && (
                <div
                  className={`${runningTools.length > 0 ? "mt-2 border-t border-white/[0.07] pt-1 light:border-slate-200" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => setDoneToolsExpanded((value) => !value)}
                    className={`flex min-h-9 w-full items-center justify-between rounded-md px-1 text-left text-[10px] font-semibold uppercase tracking-[0.1em] outline-none focus-visible:ring-2 ${
                      doneToolsNeedAttention
                        ? "text-amber-300 hover:bg-amber-400/[0.06] focus-visible:ring-amber-400/60 light:text-amber-700 light:hover:bg-amber-50"
                        : "text-theme-text-secondary hover:bg-white/[0.035] focus-visible:ring-cyan-400/60 light:hover:bg-slate-100"
                    }`}
                    aria-expanded={doneToolsExpanded}
                  >
                    <span className="flex items-center gap-2">
                      {doneToolsNeedAttention ? (
                        <WarningCircle size={14} weight="fill" />
                      ) : (
                        <CheckCircle
                          size={14}
                          weight="fill"
                          className="text-emerald-400 light:text-emerald-700"
                        />
                      )}
                      {t("chat_window.agent_invocation.status.completed")}
                    </span>
                    <span className="flex items-center gap-2 font-mono tabular-nums">
                      {doneTools.length}
                      <CaretDown
                        size={12}
                        className={`transition-transform duration-150 ${doneToolsExpanded ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>
                  {doneToolsExpanded && (
                    <ol className="m-0 space-y-0.5 p-0">
                      {doneTools.map((tool) => (
                        <ToolExecutionRow
                          key={tool.call_id || tool.id}
                          tool={tool}
                          t={t}
                        />
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}
          {recentActivities.length === 0 &&
            resourceTraces.length === 0 &&
            tasks.length === 0 &&
            tools.length === 0 && (
              <p className="m-0 px-1 py-2 text-xs text-theme-text-secondary">
                {localizedSummary ||
                  t("chat_window.agent_invocation.activity.preparing")}
              </p>
            )}
        </div>
      )}
    </section>
  );
}

export { stateFromSnapshot };
