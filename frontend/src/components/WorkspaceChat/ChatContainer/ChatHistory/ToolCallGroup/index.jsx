import { useEffect, useId, useState } from "react";
import {
  CaretDown,
  Check,
  CircleNotch,
  Clock,
  FileText,
  Globe,
  MagnifyingGlass,
  TerminalWindow,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

const ACTIVE = new Set(["requested", "running", "started", "retrying"]);
const FINISHED = new Set(["completed", "failed", "cancelled", "skipped"]);

function toolPresentation(tool, t) {
  const id = String(tool.tool_id || "");
  const key = id.replace(/[.-]/g, "_");
  const name = t(`tool_activity.names.${key}`, {
    defaultValue: id
      ? id.replace(/[.:/_-]+/g, " ")
      : t("tool_activity.unknown"),
  });
  const Icon = /bash|shell|python|code/.test(id)
    ? TerminalWindow
    : /search/.test(id)
      ? MagnifyingGlass
      : /web|fetch|download/.test(id)
        ? Globe
        : /file|read|write|convert/.test(id)
          ? FileText
          : Wrench;
  return { name, Icon };
}

function duration(tool, now, t) {
  const start = Date.parse(tool.startedAt || tool.createdAt);
  const end = tool.completedAt
    ? Date.parse(tool.completedAt)
    : ACTIVE.has(tool.status)
      ? now
      : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60
    ? t("tool_activity.seconds", { count: seconds })
    : t("tool_activity.minutes_seconds", {
        minutes: Math.floor(seconds / 60),
        seconds: seconds % 60,
      });
}

export default function ToolCallGroup({ callIds, tools, runActive }) {
  const { t } = useTranslation();
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const executions = callIds.map(
    (callId) =>
      tools.find((tool) => tool.call_id === callId) || {
        call_id: callId,
        status: runActive ? "requested" : "unknown",
      }
  );
  const active = executions.some((tool) => ACTIVE.has(tool.status));
  const failed = executions.filter((tool) => tool.status === "failed").length;
  const completed = executions.filter(
    (tool) => tool.status === "completed"
  ).length;
  const current =
    executions.find((tool) => ACTIVE.has(tool.status)) ||
    executions.find((tool) => tool.status === "failed") ||
    executions.at(-1);
  const { name, Icon } = toolPresentation(current || {}, t);
  const status = active
    ? "running"
    : failed
      ? "failed"
      : completed === executions.length
        ? "completed"
        : "stopped";
  const StatusIcon = active
    ? CircleNotch
    : failed
      ? WarningCircle
      : status === "completed"
        ? Check
        : Wrench;
  const times = executions
    .map((tool) => Date.parse(tool.startedAt || tool.createdAt))
    .filter(Number.isFinite);
  const ends = executions
    .map((tool) => Date.parse(tool.completedAt))
    .filter(Number.isFinite);
  const elapsed = duration(
    {
      status: active ? "running" : "completed",
      startedAt: times.length
        ? new Date(Math.min(...times)).toISOString()
        : null,
      completedAt:
        !active &&
        executions.every((tool) => FINISHED.has(tool.status)) &&
        ends.length === executions.length
          ? new Date(Math.max(...ends)).toISOString()
          : null,
    },
    now,
    t
  );
  const detail = current?.error || current?.result_summary;

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <section
      className="dsh-tool-group"
      data-status={status}
      aria-label={t("tool_activity.title")}
    >
      <button
        type="button"
        className="dsh-tool-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={t("chat_window.agent_invocation.react_tool_group_aria", {
          count: callIds.length,
        })}
      >
        <span className="dsh-tool-icon">
          <Icon size={17} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-theme-text-primary">
              {name}
            </span>
            <span className="dsh-tool-status">
              <StatusIcon
                size={12}
                className={active ? "motion-safe:animate-spin" : ""}
                aria-hidden="true"
              />
              {t(`tool_activity.status.${status}`)}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-theme-text-secondary">
            <span>
              {t("tool_activity.progress", {
                completed,
                total: executions.length,
              })}
            </span>
            {failed > 0 && (
              <span className="text-red-400 light:text-red-700">
                {t("tool_activity.failed", { count: failed })}
              </span>
            )}
            {elapsed && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock size={11} aria-hidden="true" />
                {elapsed}
              </span>
            )}
          </span>
          {detail && (
            <span className="mt-1 block truncate text-xs text-theme-text-secondary">
              {detail}
            </span>
          )}
        </span>
        <CaretDown
          size={14}
          className={`shrink-0 text-theme-text-secondary transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <ol id={contentId} className="dsh-tool-list">
          {executions.map((tool) => {
            const { name: toolName, Icon: ToolIcon } = toolPresentation(
              tool,
              t
            );
            const toolDuration = duration(tool, now, t);
            const summary = tool.error || tool.result_summary;
            return (
              <li key={tool.call_id} className="dsh-tool-entry">
                <ToolIcon
                  size={14}
                  className="mt-0.5 shrink-0 text-theme-text-secondary"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-xs font-medium text-theme-text-primary">
                      {toolName}
                    </span>
                    <span
                      className={`flex items-center gap-2 text-[11px] ${tool.status === "failed" ? "text-red-400 light:text-red-700" : "text-theme-text-secondary"}`}
                    >
                      {toolDuration && (
                        <span className="tabular-nums">{toolDuration}</span>
                      )}
                      {t(`chat_window.agent_invocation.status.${tool.status}`, {
                        defaultValue: t("tool_activity.status.unknown"),
                      })}
                    </span>
                  </div>
                  {summary && (
                    <p className="mb-0 mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-theme-text-secondary">
                      {summary}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
