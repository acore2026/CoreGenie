import { useState } from "react";
import { CaretDown, StopCircle } from "@phosphor-icons/react";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";
import { activityText, userFacingErrorKey } from "@/utils/userFacingError.mjs";
import {
  metaFor,
  type AgentEvidenceItem,
  type AgentTaskItem,
  type AgentToolExecution,
  type TranslateFn,
} from "./types";

interface TaskRowProps {
  task: AgentTaskItem;
  evidence: AgentEvidenceItem[];
  tools: AgentToolExecution[];
  onCommand: (type: string, taskId?: string | null) => void;
  runActive: boolean;
  runStatus?: string;
  t: TranslateFn;
}

export function TaskRow({
  task,
  evidence,
  tools,
  onCommand,
  runActive,
  runStatus,
  t,
}: TaskRowProps) {
  const [open, setOpen] = useState(false);
  const fatal = Boolean(runStatus && ["failed", "partial"].includes(runStatus));
  const meta = metaFor(
    task.status === "failed" && !fatal
      ? "skipped"
      : task.status === "retrying"
        ? "running"
        : task.status
  );
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
            {activityText(task.progress) ||
              activityText(task.resultSummary) ||
              task.objective}
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
            {activityText(task.resultSummary) || task.objective}
          </p>
          {Boolean(task.error) && fatal && task.status === "failed" && (
            <p className="m-0 mt-1 text-red-400 light:text-red-700">
              {t(userFacingErrorKey(task.error))}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[10px] tabular-nums">
            <span>
              {t(`chat_window.agent_invocation.status.${meta.labelKey}`)}
            </span>
            {(task.attempt || 0) > 1 && (
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
