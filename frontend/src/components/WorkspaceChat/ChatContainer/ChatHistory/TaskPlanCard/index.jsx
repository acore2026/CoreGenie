import { useState } from "react";
import { CaretDown, Check, ListChecks } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export default function TaskPlanCard({ tasks = [] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  if (!tasks.length) return null;
  const ordered = [...tasks].sort(
    (a, b) => (a.budget?.planOrder ?? 0) - (b.budget?.planOrder ?? 0)
  );
  const completed = tasks.filter((task) => task.status === "completed").length;
  return (
    <section className="dsh-task-card" aria-label={t("task_plan.title")}>
      <button
        type="button"
        className="dsh-task-card-heading"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <ListChecks size={17} aria-hidden="true" />
        <span className="flex-1 text-left font-medium">
          {t("task_plan.title")}
        </span>
        <span className="text-xs font-normal tabular-nums text-theme-text-secondary">
          {t("task_plan.count", { completed, total: tasks.length })}
        </span>
        <CaretDown
          size={14}
          className={`transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <ol className="m-0 list-none px-3 pb-2 pt-0">
          {ordered.map((task, index) => {
            const status = task.status || "pending";
            const current = ["running", "retrying"].includes(status);
            return (
              <li
                key={task.id}
                className="dsh-task-row"
                data-status={status}
                aria-current={current ? "step" : undefined}
              >
                <span className="dsh-task-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`m-0 break-words text-[13px] leading-5 ${current ? "font-medium text-theme-text-primary" : "text-theme-text-secondary"}`}
                  >
                    {task.title}
                  </p>
                  {(task.error || task.progress) && (
                    <p className="mb-0 mt-1 break-words text-xs leading-5 text-theme-text-secondary">
                      {task.error || task.progress}
                    </p>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-1 pt-0.5 text-[11px] text-theme-text-secondary">
                  {status === "completed" && (
                    <Check size={12} aria-hidden="true" />
                  )}
                  {t(`task_plan.status.${status}`, {
                    defaultValue: t("task_plan.status.pending"),
                  })}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
