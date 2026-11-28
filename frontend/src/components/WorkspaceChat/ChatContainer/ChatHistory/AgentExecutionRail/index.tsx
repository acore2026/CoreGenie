import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CaretDown,
  CheckCircle,
  Clock,
  GitBranch,
} from "@phosphor-icons/react";
import { v4 } from "uuid";
import { useTranslation } from "react-i18next";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { queryKeys } from "@/lib/queryKeys";
import ContextTrace from "../ContextTrace";
import { TaskRow } from "./TaskRow";
import { ToolExecutionRow } from "./ToolExecutionRow";
import {
  ACTIVE_TOOL_STATUSES,
  TERMINAL,
  elapsed,
  localizedActivity,
  metaFor,
  stateFromSnapshot,
  type AgentRunSnapshot,
  type AgentRunState,
} from "./types";

interface AgentExecutionRailProps {
  runId?: string;
  runState?: AgentRunState | null;
  transport?: WebSocket | null;
}

export default function AgentExecutionRail({
  runId,
  runState = null,
  transport = null,
}: AgentExecutionRailProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(() =>
    Boolean(runState && !TERMINAL.has(runState.status))
  );
  const [expansionWasChosen, setExpansionWasChosen] = useState(false);
  const [contextTraceExpanded, setContextTraceExpanded] = useState(false);
  const [doneToolsExpanded, setDoneToolsExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const { data: snapshotState = null } = useQuery({
    queryKey: queryKeys.agentRuns.snapshot(runId || ""),
    enabled: !runState && Boolean(runId),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${API_BASE}/agent-runs/${runId}/snapshot?view=rail`,
        {
          headers: baseHeaders() as unknown as HeadersInit,
          signal,
        }
      );
      if (!response.ok) return null;
      const snapshot = (await response.json()) as AgentRunSnapshot;
      return stateFromSnapshot(snapshot);
    },
  });

  const state = runState || snapshotState;

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

  const allTasks = state?.tasks || [];
  const tasks = allTasks.filter((task) =>
    state?.runtimeKey === "default-react"
      ? String(task.id).includes(":plan:")
      : !String(task.id).includes(":plan:")
  );
  const evidence = state?.evidence || [];
  const tools = state?.toolExecutions || [];
  const resourceTraces = state?.resourceTraces || [];
  const runningTools = tools.filter((tool) =>
    ACTIVE_TOOL_STATUSES.has(tool.status || "requested")
  );
  const doneTools = tools.filter(
    (tool) => !ACTIVE_TOOL_STATUSES.has(tool.status || "requested")
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
    state?.status === "partial"
      ? { summaryKey: "run_partial" }
      : {
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

  const sendCommand = (type: string, taskId: string | null = null) => {
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
          {tasks.length > 0 && state.status !== "partial" && (
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
                    runStatus={state?.status}
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
                      key={activity.id || index}
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
                    className="flex min-h-9 w-full items-center justify-between rounded-md px-1 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-text-secondary outline-none hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-cyan-400/60 light:hover:bg-slate-100"
                    aria-expanded={doneToolsExpanded}
                  >
                    <span className="flex items-center gap-2">
                      <CheckCircle
                        size={14}
                        weight="fill"
                        className="text-emerald-400 light:text-emerald-700"
                      />
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
