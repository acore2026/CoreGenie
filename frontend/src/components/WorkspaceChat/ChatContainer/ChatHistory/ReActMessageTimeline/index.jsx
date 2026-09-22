import { useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  Wrench,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import RenderChatContent from "../RenderChatContent";
import TaskPlanCard from "../TaskPlanCard";
import WorkingIndicator from "../TaskPlanCard/WorkingIndicator";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);
const ACTIVE = new Set(["requested", "running", "started", "retrying"]);

function mergeAdjacentToolGroups(parts = []) {
  return parts.reduce((merged, part) => {
    if (part.type === "text" && !String(part.text || "").trim()) return merged;
    const previous = merged.at(-1);
    if (part.type === "toolGroup" && previous?.type === "toolGroup") {
      previous.callIds = [
        ...new Set([...(previous.callIds || []), ...(part.callIds || [])]),
      ];
      return merged;
    }
    merged.push({
      ...part,
      ...(Array.isArray(part.callIds) ? { callIds: [...part.callIds] } : {}),
    });
    return merged;
  }, []);
}

function toolName(toolId) {
  const value = String(toolId || "Tool");
  return value.replace(/[.:/_-]+/g, " ");
}

function ToolRow({ tool, t }) {
  const status = tool.status || "requested";
  const active = ACTIVE.has(status);
  const completed = status === "completed";
  const Icon = active ? CircleNotch : completed ? CheckCircle : Wrench;
  const tone = active
    ? "text-cyan-300 light:text-cyan-700"
    : "text-theme-text-secondary";
  const detail = completed ? tool.result_summary : null;

  return (
    <li className="grid min-h-10 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 px-2 py-2">
      <Icon
        size={14}
        weight={active ? "regular" : "fill"}
        className={`mt-0.5 ${tone} ${active ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-theme-text-primary">
          {toolName(tool.tool_id)}
        </span>
        {detail && (
          <span className="mt-0.5 block whitespace-pre-wrap break-words text-[11px] leading-4 text-theme-text-secondary">
            {detail}
          </span>
        )}
      </span>
      {active && (
        <span className={`pt-0.5 text-[10px] font-semibold ${tone}`}>
          {t(`chat_window.agent_invocation.status.${status}`)}
        </span>
      )}
    </li>
  );
}

function ToolGroupBar({ callIds, tools, runActive }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const executions = callIds.map(
    (callId) =>
      tools.find((tool) => tool.call_id === callId) || {
        call_id: callId,
        status: runActive ? "requested" : "completed",
      }
  );
  const active = executions.some((tool) => ACTIVE.has(tool.status));
  const Icon = active ? CircleNotch : CheckCircle;
  const tone = active
    ? "text-cyan-300 light:text-cyan-700"
    : "text-theme-text-secondary";
  const label = active
    ? t("chat_window.agent_invocation.react_tools_running", {
        count: callIds.length,
      })
    : t("chat_window.agent_invocation.react_tools_complete", {
        count: callIds.length,
      });

  return (
    <div className="max-w-[780px] overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.015] light:border-slate-200 light:bg-slate-50/60">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)_16px] items-center gap-2 px-2.5 text-left outline-none transition-[background-color,transform] duration-150 hover:bg-white/[0.035] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 motion-reduce:transition-none light:hover:bg-slate-100"
        aria-expanded={expanded}
        aria-label={t("chat_window.agent_invocation.react_tool_group_aria", {
          count: callIds.length,
        })}
      >
        <span className="relative flex items-center justify-center">
          <Wrench size={14} className={tone} aria-hidden="true" />
          <Icon
            size={9}
            weight={active ? "regular" : "fill"}
            className={`absolute -bottom-1 -right-0.5 rounded-full bg-theme-bg-primary ${tone} ${active ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
        </span>
        <span
          className={`truncate text-xs font-medium ${tone}`}
          aria-live={active ? "polite" : undefined}
        >
          {label}
        </span>
        <CaretDown
          size={13}
          className={`text-theme-text-secondary transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <ol className="m-0 divide-y divide-white/[0.06] border-t border-white/[0.07] p-0 light:divide-slate-100 light:border-slate-200">
          {executions.map((tool) => (
            <ToolRow key={tool.call_id || tool.id} tool={tool} t={t} />
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ReActMessageTimeline({
  runId,
  runState = null,
  parts = [],
  fallbackText = "",
  messageId,
}) {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (runState || !runId) return;
    const controller = new AbortController();
    let timer;
    setSnapshot(null);
    const refresh = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/agent-runs/${runId}/snapshot?view=rail`,
          {
            headers: baseHeaders(),
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          if (response.status >= 500 || response.status === 429)
            timer = setTimeout(refresh, 4000);
          return;
        }
        const next = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot(next);
        if (next?.run && !TERMINAL.has(next.run.status))
          timer = setTimeout(refresh, 2000);
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 4000);
      }
    };
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, runState]);

  const tools = (
    runState?.toolExecutions ||
    snapshot?.toolExecutions ||
    []
  ).filter((tool) => tool.tool_id !== "plan.update");
  const tasks = runState?.tasks || snapshot?.tasks || [];
  const status = runState?.status || snapshot?.run?.status;
  const messageParts = useMemo(() => {
    const source = runState?.messageParts?.length
      ? runState.messageParts
      : parts?.length
        ? parts
        : [];
    return mergeAdjacentToolGroups(source);
  }, [parts, runState?.messageParts]);
  const runActive = Boolean(status && !TERMINAL.has(status));

  return (
    <div className="space-y-3">
      <TaskPlanCard tasks={tasks} />
      {!messageParts.length ? (
        <>
          {tools.length > 0 && (
            <ToolGroupBar
              callIds={tools.map((tool) => tool.call_id)}
              tools={tools}
              runActive={runActive}
            />
          )}
          {fallbackText && (
            <RenderChatContent
              role="assistant"
              message={fallbackText}
              messageId={messageId}
            />
          )}
        </>
      ) : (
        messageParts.map((part) => {
          if (part.type === "toolGroup") {
            const calls = (part.callIds || []).filter(
              (id) =>
                !(
                  runState?.toolExecutions ||
                  snapshot?.toolExecutions ||
                  []
                ).some(
                  (tool) =>
                    tool.call_id === id && tool.tool_id === "plan.update"
                )
            );
            return calls.length ? (
              <ToolGroupBar
                key={part.id}
                callIds={calls}
                tools={tools}
                runActive={runActive}
              />
            ) : null;
          }
          return part.text ? (
            <div key={part.id}>
              <RenderChatContent
                role="assistant"
                message={part.text}
                messageId={`${messageId}:${part.id}`}
              />
            </div>
          ) : null;
        })
      )}
      <WorkingIndicator status={status} />
    </div>
  );
}
