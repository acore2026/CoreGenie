import { useEffect, useId, useState } from "react";
import { ListChecks, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { conversationPlanRuns, planTasks } from "@/utils/taskPlan.mjs";
import TaskPlanCard from "../ChatHistory/TaskPlanCard";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

export default function TaskPlanPanel({ history = [], onClose }) {
  const { t } = useTranslation();
  const selectId = useId();
  const runs = conversationPlanRuns(history);
  const [chosen, setChosen] = useState(null);
  const run = runs.find((item) => item.id === chosen) || runs[0];
  const runId = run?.id;
  const liveState = run?.state;
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setSnapshot(null);
    setError(false);
    if (!runId || liveState) return;
    const controller = new AbortController();
    let timer;
    const refresh = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/agent-runs/${runId}/snapshot?view=rail`,
          {
            headers: baseHeaders(),
            signal: controller.signal,
          }
        );
        if (!response.ok) throw new Error("snapshot");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot({ id: runId, ...data });
        setError(false);
        if (data.run && !TERMINAL.has(data.run.status))
          timer = setTimeout(refresh, 2000);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, liveState, retry]);
  const currentSnapshot = snapshot?.id === runId ? snapshot : null;
  const tasks = planTasks(
    liveState?.tasks || currentSnapshot?.tasks || [],
    liveState?.runtimeKey || currentSnapshot?.run?.runtimeKey || run?.runtimeKey
  );
  const status = liveState?.status || currentSnapshot?.run?.status;
  const loading = Boolean(runId && !liveState && !currentSnapshot && !error);
  return (
    <div className="shrink-0 border-b border-theme-sidebar-border bg-theme-bg-chat text-theme-text-primary">
      {onClose && (
        <div className="flex justify-end px-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("task_plan.close_panel")}
            className="dsh-control flex h-10 w-10 items-center justify-center rounded-lg hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
          >
            <X size={18} />
          </button>
        </div>
      )}
      {runs.length > 1 && (
        <div className="px-4 pt-3">
          <label htmlFor={selectId} className="sr-only">
            {t("task_plan.choose_run")}
          </label>
          <select
            id={selectId}
            value={chosen || ""}
            onChange={(event) => setChosen(event.target.value || null)}
            className="min-h-[40px] w-full rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input px-2 text-xs text-theme-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
          >
            <option value="">{t("task_plan.latest")}</option>
            {runs.slice(1).map((item, index) => (
              <option key={item.id} value={item.id}>
                {t("task_plan.previous_run", {
                  count: runs.length - index - 1,
                })}
              </option>
            ))}
          </select>
        </div>
      )}
      {tasks.length ? (
        <TaskPlanCard key={runId} tasks={tasks} status={status} />
      ) : (
        <section className="px-4 py-4" aria-label={t("task_plan.title")}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks size={18} />
            {t("task_plan.title")}
          </h2>
          <p
            className="mb-0 mt-3 text-xs leading-5 text-theme-text-secondary"
            role="status"
          >
            {t(
              error
                ? "task_plan.load_error"
                : loading
                  ? "task_plan.loading"
                  : runId
                    ? "task_plan.no_plan"
                    : "task_plan.empty"
            )}
          </p>
          {error && (
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className="dsh-control mt-2 min-h-[40px] rounded-lg px-3 text-xs hover:bg-theme-sidebar-subitem-hover focus-visible:ring-2 focus-visible:ring-primary-button"
            >
              {t("task_plan.retry")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
