import { useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  CheckCircle,
  Circle,
  Clock,
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

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

const statusMeta = {
  completed: {
    Icon: CheckCircle,
    label: "Verified",
    tone: "text-emerald-400 light:text-emerald-700",
  },
  running: {
    Icon: Circle,
    label: "Working",
    tone: "text-cyan-300 light:text-cyan-700",
  },
  retrying: {
    Icon: Clock,
    label: "Retrying",
    tone: "text-amber-300 light:text-amber-700",
  },
  waiting_for_input: {
    Icon: Clock,
    label: "Waiting for input",
    tone: "text-amber-300 light:text-amber-700",
  },
  waiting_for_approval: {
    Icon: Clock,
    label: "Waiting for approval",
    tone: "text-amber-300 light:text-amber-700",
  },
  failed: {
    Icon: WarningCircle,
    label: "Failed",
    tone: "text-red-400 light:text-red-700",
  },
  cancelled: {
    Icon: XCircle,
    label: "Cancelled",
    tone: "text-zinc-500 light:text-slate-500",
  },
  skipped: {
    Icon: MinusCircle,
    label: "Skipped",
    tone: "text-zinc-500 light:text-slate-500",
  },
  partial: {
    Icon: WarningCircle,
    label: "Partial result",
    tone: "text-amber-300 light:text-amber-700",
  },
};

function metaFor(status) {
  return statusMeta[status] || statusMeta.running;
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

function stateFromSnapshot(snapshot) {
  if (!snapshot?.run) return null;
  return {
    runId: snapshot.run.id,
    status: snapshot.run.status,
    phase: snapshot.run.phase,
    summary:
      snapshot.run.status === "partial"
        ? "Finished with partial results"
        : TERMINAL.has(snapshot.run.status)
          ? "Agent work complete"
          : "Restoring Agent work",
    agent: snapshot.run.runtimeSnapshot?.agent,
    startedAt: snapshot.run.startedAt || snapshot.run.createdAt,
    completedAt: snapshot.run.completedAt,
    tasks: snapshot.tasks || [],
    evidence: snapshot.evidence || [],
    toolExecutions: snapshot.toolExecutions || [],
  };
}

function TaskRow({ task, evidence, tools, onCommand, runActive }) {
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
          className={`mt-0.5 ${meta.tone}`}
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
          {taskTools.length > 0 && <span>{taskTools.length} tools</span>}
          {taskEvidence.length > 0 && (
            <span>{taskEvidence.length} sources</span>
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
            <span>{meta.label}</span>
            {task.attempt > 1 && <span>attempt {task.attempt}</span>}
            {taskTools.length > 0 && <span>{taskTools.length} tool calls</span>}
            {taskEvidence.length > 0 && (
              <span>{taskEvidence.length} evidence items</span>
            )}
          </div>
          {canStop && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onCommand("task.cancel", task.id)}
                className="inline-flex min-h-8 items-center gap-1 rounded-md border border-red-400/20 px-2 text-[10px] font-semibold text-red-300 hover:bg-red-400/10 focus-visible:ring-2 focus-visible:ring-red-400/60 light:text-red-700"
              >
                <StopCircle size={13} /> Cancel task
              </button>
              {task.status === "pending" && (
                <button
                  type="button"
                  onClick={() => onCommand("task.skip", task.id)}
                  className="min-h-8 rounded-md border border-white/10 px-2 text-[10px] font-semibold text-theme-text-secondary hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-cyan-400/60 light:border-slate-200 light:hover:bg-slate-100"
                >
                  Skip
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
  const [expanded, setExpanded] = useState(false);
  const [snapshotState, setSnapshotState] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const state = runState || snapshotState;

  useEffect(() => {
    if (runState || !runId) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/agent-runs/${runId}/snapshot`, {
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

  const tasks = state?.tasks || [];
  const evidence = state?.evidence || [];
  const tools = state?.toolExecutions || [];
  const completed = tasks.filter((task) => task.status === "completed").length;
  const runActive = state ? !TERMINAL.has(state.status) : false;
  const meta = metaFor(state?.status || "running");
  const MetaIcon = meta.Icon;
  const duration = elapsed(state?.startedAt, state?.completedAt, now);
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
      className="mb-3 w-full max-w-[780px] overflow-hidden rounded-lg border border-white/[0.09] bg-theme-bg-container text-theme-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] light:border-slate-200"
      aria-label="Agent execution"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
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
            size={10}
            weight="fill"
            className={`absolute -bottom-1 -right-1 rounded-full bg-theme-bg-container ${meta.tone}`}
          />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-text-secondary">
            <span className={meta.tone}>{meta.label}</span>
            {state.agent?.name && (
              <span className="truncate">{state.agent.name}</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[13px] font-medium leading-4">
            {currentTask?.progress ||
              currentTask?.title ||
              state.summary ||
              "Agent working"}
          </span>
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-theme-text-secondary">
          {duration && <span>{duration}</span>}
          {tasks.length > 0 && (
            <span>
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
          {tasks.length ? (
            <ol className="m-0 space-y-1 p-0">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  evidence={evidence}
                  tools={tools}
                  onCommand={sendCommand}
                  runActive={runActive}
                />
              ))}
            </ol>
          ) : (
            <p className="m-0 px-1 py-2 text-xs text-theme-text-secondary">
              {state.summary || "Preparing the request"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export { stateFromSnapshot };
