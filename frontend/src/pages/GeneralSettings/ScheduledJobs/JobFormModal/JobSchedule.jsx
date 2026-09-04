import { useTranslation } from "react-i18next";
import CronBuilder from "./CronBuilder";
import { humanizeCron } from "../utils/cron";

export default function JobSchedule({ schedule, error, onScheduleChange }) {
  const { t, i18n } = useTranslation();

  return (
    <div>
      <label className="flex items-baseline gap-1.5 mb-2 text-sm font-medium text-theme-text-primary">
        <span>
          {t("scheduledJobs.modal.scheduleLabel")}{" "}
          <span className="text-red-400">*</span>
        </span>
        {error && (
          <span className="text-red-400 italic font-normal">
            {t("scheduledJobs.modal.required", "Required")}
          </span>
        )}
      </label>

      <div
        className={`rounded-lg border ${
          error ? "border-red-300" : "border-transparent"
        }`}
      >
        <CronBuilder value={schedule} onChange={onScheduleChange} />
      </div>

      <p className="text-xs text-theme-text-secondary mt-2">
        {t("scheduledJobs.modal.currentSchedule")}{" "}
        {schedule && <span>{humanizeCron(schedule, i18n.language)}</span>}
      </p>
    </div>
  );
}
