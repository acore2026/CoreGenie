import { CheckCircle, CircleNotch, MinusCircle } from "@phosphor-icons/react";
import { toolActivityText } from "@/utils/userFacingError.ts";
import {
  ACTIVE_TOOL_STATUSES,
  toolName,
  type AgentToolExecution,
  type TranslateFn,
} from "./types";

interface ToolExecutionRowProps {
  tool: AgentToolExecution;
  t: TranslateFn;
}

export function ToolExecutionRow({ tool, t }: ToolExecutionRowProps) {
  const status = tool.status || "requested";
  const active = ACTIVE_TOOL_STATUSES.has(status);
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const skipped = status === "skipped";
  const Icon = active
    ? CircleNotch
    : failed || cancelled || skipped
      ? MinusCircle
      : CheckCircle;
  const tone = active
    ? "text-cyan-300 light:text-cyan-700"
    : failed
      ? "text-zinc-400 light:text-slate-600"
      : cancelled || skipped
        ? "text-zinc-500 light:text-slate-500"
        : "text-emerald-400 light:text-emerald-700";
  const detail = toolActivityText(tool);

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
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-theme-text-secondary">
            {detail}
          </span>
        )}
      </span>
      <span className={`pt-0.5 text-[10px] font-semibold capitalize ${tone}`}>
        {failed
          ? t("user_error.step_stopped")
          : t(
              `chat_window.agent_invocation.status.${active ? "running" : status}`
            )}
      </span>
    </li>
  );
}
