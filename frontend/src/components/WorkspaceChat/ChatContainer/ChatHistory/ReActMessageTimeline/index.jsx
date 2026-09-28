import { useEffect, useMemo, useState } from "react";
import ToolCallGroup from "../ToolCallGroup";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import RenderChatContent from "../RenderChatContent";
import TaskPlanCard from "../TaskPlanCard";
import WorkingIndicator from "../TaskPlanCard/WorkingIndicator";

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

  return (
    <div className="space-y-3">
      <TaskPlanCard tasks={tasks} />
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
        })
      )}
      <WorkingIndicator status={status} />
    </div>
  );
}
