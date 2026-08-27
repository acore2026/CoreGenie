import { useState } from "react";
import {
  CaretDown,
  CheckCircle,
  GitBranch,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";

export default function SubagentRun({ run, live = false }) {
  const [expanded, setExpanded] = useState(live);
  const running = run.status === "running";
  const failed = run.status === "failed";
  const depth = Math.max(1, Math.min(Number(run.depth) || 1, 3));

  return (
    <div
      style={{ marginLeft: `${(depth - 1) * 14}px` }}
      className={`relative my-2 overflow-hidden rounded-xl border bg-zinc-900/90 shadow-[0_12px_35px_rgba(0,0,0,0.16)] light:bg-white ${
        failed
          ? "border-red-400/30"
          : running
            ? "border-cyan-300/35"
            : "border-emerald-300/25"
      }`}
    >
      <div
        className={`absolute bottom-0 left-0 top-0 w-0.5 ${
          failed ? "bg-red-400" : running ? "bg-cyan-300" : "bg-emerald-300"
        }`}
      />
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <div className="relative shrink-0">
          <AgentAvatar
            agent={run.agent || {}}
            size={34}
            className="!rounded-lg"
          />
          <span
            className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-zinc-900 light:border-white ${
              failed
                ? "bg-red-400 text-white"
                : running
                  ? "bg-cyan-300 text-zinc-950"
                  : "bg-emerald-300 text-emerald-950"
            }`}
          >
            {failed ? (
              <WarningCircle size={10} weight="fill" />
            ) : running ? (
              <SpinnerGap size={10} weight="bold" className="animate-spin" />
            ) : (
              <CheckCircle size={10} weight="fill" />
            )}
          </span>
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-300 light:text-cyan-700">
              Subagent
            </span>
            <GitBranch size={11} className="text-zinc-600" />
            <span className="truncate text-xs font-semibold text-zinc-100 light:text-slate-900">
              {run.agent?.name || "Specialist"}
            </span>
          </span>
          <span className="mt-1 block truncate text-[11px] text-zinc-500 light:text-slate-500">
            {running
              ? "Working independently on the delegated task"
              : failed
                ? "Delegation failed"
                : "Result returned to the parent Agent"}
          </span>
        </span>
        <CaretDown
          size={13}
          weight="bold"
          className={`shrink-0 text-zinc-600 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-white/[0.07] px-3.5 py-3 light:border-slate-200">
          <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-600 light:text-slate-400">
            Mission
          </p>
          <p className="whitespace-pre-wrap text-xs leading-5 text-zinc-300 light:text-slate-700">
            {run.task}
          </p>
          {(run.result || run.error) && (
            <div
              className={`mt-3 rounded-lg border p-3 ${
                failed
                  ? "border-red-400/20 bg-red-400/[0.05]"
                  : "border-emerald-300/15 bg-emerald-300/[0.045]"
              }`}
            >
              <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-600 light:text-slate-400">
                {failed ? "Error" : "Returned result"}
              </p>
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-zinc-300 light:text-slate-700">
                {run.error || run.result}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
