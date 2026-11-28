import { useId, useState } from "react";
import {
  CaretDown,
  Check,
  ListChecks,
  Pause,
  WarningCircle,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { activityText, userFacingErrorKey } from "@/utils/userFacingError.ts";

export default function TaskPlanCard({ tasks = [], status }) {
  const { t } = useTranslation();
  const listId = useId();
  const [expanded, setExpanded] = useState(true);
  if (!tasks.length) return null;
  const ordered = [...tasks].sort(
    (a, b) => (a.budget?.planOrder ?? 0) - (b.budget?.planOrder ?? 0)
  );
  const completed = tasks.filter((task) => task.status === "completed").length;
  const stopped = ["cancelled", "failed", "partial"].includes(status);
  const current =
    !stopped &&
    ordered.find((task) => ["running", "retrying"].includes(task.status));
  return (
    <section
      className="px-4 py-4 text-theme-text-primary"
      aria-label={t("task_plan.title")}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={listId}
        className="flex min-h-[40px] w-full items-center gap-2 rounded-lg text-left hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
      >
        <ListChecks size={18} aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold">
          {t("task_plan.title")}
        </span>
        <span className="text-xs tabular-nums text-theme-text-secondary">
          {completed}/{tasks.length}
        </span>
        <CaretDown
          size={14}
          aria-hidden="true"
          className={expanded ? "rotate-180" : ""}
        />
      </button>
      <div
        role="progressbar"
        aria-label={t("task_plan.count", { completed, total: tasks.length })}
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={tasks.length}
        className="mt-2 h-1 overflow-hidden rounded-full bg-theme-sidebar-border"
      >
        <div
          className="h-full rounded-full bg-primary-button"
          style={{ width: `${(completed / tasks.length) * 100}%` }}
        />
      </div>
      {(current || stopped) && (
        <p
          className="mb-0 mt-3 text-xs leading-5 text-theme-text-secondary"
          role="status"
        >
          {stopped
            ? t(`task_plan.run_status.${status}`)
            : t("task_plan.current", { title: current.title })}
        </p>
      )}
      {expanded && (
        <ol
          id={listId}
          className="m-0 mt-3 max-h-[32dvh] list-none space-y-1 overflow-y-auto overscroll-contain p-0 pr-1"
        >
          {ordered.map((task, index) => {
            const taskStatus =
              stopped &&
              ["running", "retrying", "queued", "planned", "pending"].includes(
                task.status
              )
                ? status === "cancelled"
                  ? "cancelled"
                  : "pending"
                : task.status || "pending";
            const active = ["running", "retrying"].includes(taskStatus);
            const done = taskStatus === "completed";
            const failed =
              taskStatus === "failed" && ["failed", "partial"].includes(status);
            const detail =
              failed && task.error
                ? t(userFacingErrorKey(task.error))
                : activityText(task.progress);
            return (
              <li
                key={task.id}
                aria-current={active ? "step" : undefined}
                className={`flex min-h-[48px] gap-3 rounded-lg px-2 py-2 ${active ? "bg-theme-sidebar-item-default-selected" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums ${done ? "border-emerald-500/30 text-emerald-500" : failed ? "border-red-400/30 text-red-400" : "border-theme-sidebar-border text-theme-text-secondary"}`}
                >
                  {done ? (
                    <Check size={12} />
                  ) : failed ? (
                    <WarningCircle size={13} />
                  ) : taskStatus === "cancelled" ? (
                    <Pause size={11} />
                  ) : (
                    index + 1
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`m-0 break-words text-[13px] leading-5 ${active ? "font-medium" : "text-theme-text-secondary"}`}
                  >
                    {task.title}
                  </p>
                  <span className="text-[11px] text-theme-text-secondary">
                    {t(
                      `task_plan.status.${taskStatus === "failed" && !failed ? "stopped" : taskStatus === "retrying" ? "running" : taskStatus}`,
                      {
                        defaultValue: t("task_plan.status.pending"),
                      }
                    )}
                  </span>
                  {detail && (
                    <details className="mt-1 text-xs text-theme-text-secondary">
                      <summary className="min-h-[28px] cursor-pointer rounded leading-7 hover:text-theme-text-primary focus-visible:ring-2 focus-visible:ring-primary-button">
                        {t("task_plan.details")}
                      </summary>
                      <p className="my-1 break-words leading-5">{detail}</p>
                    </details>
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
