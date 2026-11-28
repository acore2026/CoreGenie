import {
  CheckCircle,
  CircleNotch,
  Clock,
  ClockCountdown,
  MinusCircle,
  WarningCircle,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";
import { reduceAgentRunState } from "@/utils/chat/agent";
import { activityText, userFacingErrorKey } from "@/utils/userFacingError.ts";

export const TERMINAL = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export const ACTIVE_TOOL_STATUSES = new Set([
  "requested",
  "running",
  "started",
  "retrying",
]);

export interface StatusMeta {
  Icon: Icon;
  labelKey: string;
  tone: string;
}

export type {
  Activity as AgentActivity,
  Task as AgentTaskItem,
  ToolExecution as AgentToolExecution,
  Evidence as AgentEvidenceItem,
} from "@/utils/chat/agentRunTypes";
import type {
  Activity as AgentActivity,
  AgentRunState as RunState,
  AgentRunEvent,
  Task as AgentTaskItem,
  Evidence as AgentEvidenceItem,
  ToolExecution as AgentToolExecution,
} from "@/utils/chat/agentRunTypes";
export type AgentRunState = Partial<RunState>;

export interface AgentRunSnapshot {
  run?: {
    id: string;
    status: string;
    phase?: string;
    runtimeKey?: string;
    error?: string;
    runtimeSnapshot?: { agent?: { name?: string; [key: string]: unknown } };
    startedAt?: string;
    createdAt?: string;
    completedAt?: string;
  };
  events?: AgentRunEvent[];
  tasks?: AgentTaskItem[];
  evidence?: AgentEvidenceItem[];
  toolExecutions?: AgentToolExecution[];
}

export type TranslateFn = (
  key: string,
  options?: Record<string, unknown>
) => string;

const statusMeta: Record<string, StatusMeta> = {
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
    Icon: CheckCircle,
    labelKey: "partial",
    tone: "text-amber-400 light:text-amber-700",
  },
};

export function metaFor(status?: string): StatusMeta {
  return (status && statusMeta[status]) || statusMeta.pending;
}

export function elapsed(
  startedAt: string | undefined,
  completedAt: string | null | undefined,
  now: number
): string | null {
  if (!startedAt) return null;
  const end = completedAt ? new Date(completedAt).getTime() : now;
  const seconds = Math.max(
    0,
    Math.round((end - new Date(startedAt).getTime()) / 1_000)
  );
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function toolName(toolId?: string): string {
  const value = String(toolId || "Tool");
  const segment = value.split(/[.:/]/).filter(Boolean).at(-1) || value;
  return segment.replace(/[-_]+/g, " ");
}

export function localizedActivity(
  activity: Partial<AgentActivity> | undefined,
  t: TranslateFn
): string | null {
  if (!activity) return "";
  if (
    activity.summaryKey &&
    ["tool_failed", "task_failed"].includes(activity.summaryKey)
  )
    return null;
  if (
    activity.summaryKey &&
    ["run_failed", "run_failed_with_error"].includes(activity.summaryKey)
  )
    return t(userFacingErrorKey(activity.summaryArgs?.error));
  if (
    activity.summaryKey &&
    ["task_retrying", "retrying_visible_response"].includes(activity.summaryKey)
  )
    return t("task_plan.working");
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
  return activityText(summary);
}

export function stateFromSnapshot(
  snapshot: AgentRunSnapshot | null | undefined
): AgentRunState | null {
  if (!snapshot?.run) return null;
  const fallbackSummary = TERMINAL.has(snapshot.run.status)
    ? "Agent work complete"
    : "Restoring Agent work";
  const fallbackSummaryKey = TERMINAL.has(snapshot.run.status)
    ? snapshot.run.status === "partial"
      ? "run_completed"
      : `run_${snapshot.run.status}`
    : "restoring";
  const replayed = (snapshot.events || []).reduce<AgentRunState>(
    reduceAgentRunState,
    {
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
    }
  );
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
      replayed.activities && replayed.activities.length > 0
        ? replayed.activities
        : [
            {
              id: `${snapshot.run.id}:snapshot`,
              summaryKey: fallbackSummaryKey,
            },
          ],
  };
}
