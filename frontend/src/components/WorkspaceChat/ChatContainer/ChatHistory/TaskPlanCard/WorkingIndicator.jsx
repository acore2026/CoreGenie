import { CircleNotch } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export const isAgentWorking = (status) =>
  [
    "pending",
    "queued",
    "running",
    "planning",
    "executing",
    "retrying",
    "resuming",
  ].includes(status);

export default function WorkingIndicator({ status }) {
  const { t } = useTranslation();
  if (!isAgentWorking(status)) return null;
  return (
    <div
      className="flex min-h-8 items-center pt-2 text-theme-text-secondary"
      role="status"
      aria-label={t("task_plan.working")}
      data-agent-working="true"
    >
      <CircleNotch
        size={18}
        weight="bold"
        className="motion-safe:animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="sr-only">{t("task_plan.working")}</span>
    </div>
  );
}
