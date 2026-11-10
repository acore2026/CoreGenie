import { useEffect, useId, useMemo, useState } from "react";
import { CaretRight, CheckCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { completedTimeline } from "@/utils/reactTimeline.mjs";
import { userFacingErrorKey } from "@/utils/userFacingError.mjs";
import ToolCallGroup from "../ToolCallGroup";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import RenderChatContent from "../RenderChatContent";
import TaskPlanCard from "../TaskPlanCard";
import WorkingIndicator from "../TaskPlanCard/WorkingIndicator";
import { useChatSidebar } from "../../ChatSidebar";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

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

export default function ReActMessageTimeline({
  runId,
  runState = null,
  parts = [],
  fallbackText = "",
  messageId,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const { t } = useTranslation();
  const historyId = useId();
  const [expandedRun, setExpandedRun] = useState(null);
  const sidebar = useChatSidebar();

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
  const runtimeKey = runState?.runtimeKey || snapshot?.run?.runtimeKey;
  const allTasks = runState?.tasks || snapshot?.tasks || [];
  const tasks = allTasks.filter((task) =>
    runtimeKey === "default-react"
      ? String(task.id).includes(":plan:")
      : !String(task.id).includes(":plan:")
  );
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
  const completed = completedTimeline(
    messageParts,
    status,
    fallbackText,
    tools.length
  );
  const expanded = expandedRun === runId;
  useEffect(() => {
    setExpandedRun(null);
  }, [runId, status]);

  const renderPart = (part) => {
    if (part.type === "toolGroup") {
      const calls = (part.callIds || []).filter(
        (id) =>
          !(runState?.toolExecutions || snapshot?.toolExecutions || []).some(
            (tool) => tool.call_id === id && tool.tool_id === "plan.update"
          )
      );
      return calls.length ? (
        <ToolCallGroup
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
  };

  if (completed)
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-theme-sidebar-border">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={historyId}
            onClick={() => setExpandedRun(expanded ? null : runId)}
            className="flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-3 text-left hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
          >
            <CheckCircle
              size={18}
              weight="fill"
              className="shrink-0 text-green-500 light:text-green-700"
            />
            <span className="text-sm font-medium text-theme-text-primary">
              {t("react_history.completed")}
            </span>
            <span className="flex-1 text-xs tabular-nums text-theme-text-secondary">
              {t("react_history.tool_count", { count: tools.length })}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-theme-text-primary">
              {t(expanded ? "react_history.hide" : "react_history.show")}
              <CaretRight size={14} className={expanded ? "rotate-90" : ""} />
            </span>
          </button>
          {expanded && (
            <div
              id={historyId}
              className="space-y-3 border-t border-theme-sidebar-border p-3"
            >
              {!sidebar && <TaskPlanCard tasks={tasks} status={status} />}
              {completed.history.length
                ? completed.history.map(renderPart)
                : tools.length > 0 && (
                    <ToolCallGroup
                      callIds={tools.map((tool) => tool.call_id)}
                      tools={tools}
                      runActive={false}
                    />
                  )}
            </div>
          )}
        </div>
        <section aria-label={t("react_history.result")}>
          <RenderChatContent
            role="assistant"
            message={completed.answer}
            messageId={`${messageId}:final`}
          />
        </section>
      </div>
    );

  return (
    <div className="space-y-3">
      {["failed", "partial"].includes(status) && (
        <p role="status" className="text-sm text-theme-text-secondary">
          {status === "partial"
            ? t("task_plan.run_status.partial")
            : t(
                userFacingErrorKey(
                  runState?.error ||
                    runState?.summaryArgs?.error ||
                    snapshot?.run?.error
                )
              )}
        </p>
      )}
      {!sidebar && <TaskPlanCard tasks={tasks} status={status} />}
      {!messageParts.length ? (
        <>
          {tools.length > 0 && (
            <ToolCallGroup
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
        messageParts.map(renderPart)
      )}
      <WorkingIndicator status={status} />
    </div>
  );
}
