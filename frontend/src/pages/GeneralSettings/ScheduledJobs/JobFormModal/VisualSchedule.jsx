import { CalendarBlank, Clock, Repeat } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

const MINUTE_INTERVALS = [1, 2, 5, 10, 15, 20, 30];
const HOUR_INTERVALS = [1, 2, 4, 6, 8, 12];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

function pad(value) {
  return String(value).padStart(2, "0");
}

function localDateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultOnce() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return { date: localDateValue(date) };
}

export function defaultScheduleConfig() {
  return {
    type: "recurring",
    frequency: "daily",
    interval: 1,
    weekdays: [1],
    day: 1,
    time: "09:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ...defaultOnce(),
  };
}

export function editableScheduleConfig(value) {
  const fallback = defaultScheduleConfig();
  if (!value?.type) return fallback;
  return {
    ...fallback,
    ...value,
    date: value.date || fallback.date,
    time: value.time || fallback.time,
    weekdays: value.weekdays?.length ? value.weekdays : [1],
    day: value.day || 1,
    timezone: value.timezone || fallback.timezone,
  };
}

export function scheduleSummary(config, t) {
  if (!config?.type) return t("scheduledJobs.visual.legacy");
  if (config.type === "once")
    return t("scheduledJobs.visual.summaryOnce", {
      date: config.date,
      time: config.time,
    });
  if (config.frequency === "minute")
    return t("scheduledJobs.visual.summaryMinute", { count: config.interval });
  if (config.frequency === "hour")
    return t("scheduledJobs.visual.summaryHour", { count: config.interval });
  if (config.frequency === "daily")
    return t("scheduledJobs.visual.summaryDaily", { time: config.time });
  if (config.frequency === "weekly") {
    const days = WEEKDAYS.filter((day) => config.weekdays?.includes(day))
      .map((day) => t(`scheduledJobs.visual.weekday.${day}`))
      .join("、");
    return t("scheduledJobs.visual.summaryWeekly", { days, time: config.time });
  }
  return t("scheduledJobs.visual.summaryMonthly", {
    day:
      config.day === "last"
        ? t("scheduledJobs.visual.lastDay")
        : t("scheduledJobs.visual.dayValue", { day: config.day }),
    time: config.time,
  });
}

function previewDates(config, count = 3) {
  const now = new Date();
  if (config.type === "once") {
    const date = new Date(`${config.date}T${config.time}:00`);
    return Number.isNaN(date.getTime()) ? [] : [date];
  }
  if (["minute", "hour"].includes(config.frequency)) {
    const unit = config.frequency === "minute" ? 60_000 : 3_600_000;
    const intervalMs = Number(config.interval) * unit;
    const anchor = config.anchorAt ? new Date(config.anchorAt) : now;
    const elapsed = Math.max(0, now.getTime() - anchor.getTime());
    const first =
      anchor.getTime() > now.getTime()
        ? anchor.getTime()
        : anchor.getTime() +
          (Math.floor(elapsed / intervalMs) + 1) * intervalMs;
    return Array.from(
      { length: count },
      (_, index) => new Date(first + index * intervalMs)
    );
  }
  const [hour, minute] = config.time.split(":").map(Number);
  const dates = [];
  for (let offset = 0; offset < 400 && dates.length < count; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= now) continue;
    if (
      config.frequency === "weekly" &&
      !config.weekdays.includes(candidate.getDay())
    )
      continue;
    if (config.frequency === "monthly") {
      const last = new Date(
        candidate.getFullYear(),
        candidate.getMonth() + 1,
        0
      ).getDate();
      const target = config.day === "last" ? last : Number(config.day);
      if (candidate.getDate() !== target) continue;
    }
    dates.push(candidate);
  }
  return dates;
}

const controlClass =
  "h-10 rounded-lg border border-white/10 bg-theme-settings-input-bg px-3 text-sm text-theme-text-primary outline-none transition-[border-color,box-shadow] focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15 light:border-slate-300";

function Segment({ active, icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
        active
          ? "border-cyan-400/35 bg-cyan-400/10 text-cyan-200 light:text-cyan-800"
          : "border-transparent text-theme-text-secondary hover:bg-white/5 hover:text-theme-text-primary light:hover:bg-slate-100"
      }`}
    >
      <Icon size={17} weight="duotone" />
      {children}
    </button>
  );
}

export default function VisualSchedule({ value, onChange, error }) {
  const { t } = useTranslation();
  const config = editableScheduleConfig(value);
  const update = (patch) => onChange({ ...config, ...patch });
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const previews =
    config.timezone === browserTimezone ? previewDates(config) : [];

  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium text-theme-text-primary">
        {t("scheduledJobs.modal.scheduleLabel")}
        <span className="ml-1 text-red-400">*</span>
      </legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-theme-settings-input-bg/40 p-1 light:border-slate-300">
        <Segment
          active={config.type === "once"}
          icon={CalendarBlank}
          onClick={() => update({ type: "once" })}
        >
          {t("scheduledJobs.visual.once")}
        </Segment>
        <Segment
          active={config.type === "recurring"}
          icon={Repeat}
          onClick={() => update({ type: "recurring" })}
        >
          {t("scheduledJobs.visual.recurring")}
        </Segment>
      </div>

      {config.type === "once" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium text-theme-text-secondary">
            <span>{t("scheduledJobs.visual.date")}</span>
            <input
              type="date"
              min={localDateValue(new Date())}
              value={config.date}
              onChange={(event) => update({ date: event.target.value })}
              className={`${controlClass} w-full [color-scheme:dark] light:[color-scheme:light]`}
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-theme-text-secondary">
            <span>{t("scheduledJobs.visual.time")}</span>
            <input
              type="time"
              value={config.time}
              onChange={(event) => update({ time: event.target.value })}
              className={`${controlClass} w-full [color-scheme:dark] light:[color-scheme:light]`}
            />
          </label>
        </div>
      ) : (
        <>
          <label className="block space-y-1.5 text-xs font-medium text-theme-text-secondary">
            <span>{t("scheduledJobs.visual.frequency")}</span>
            <select
              value={config.frequency}
              onChange={(event) => update({ frequency: event.target.value })}
              className={`${controlClass} w-full`}
            >
              <option value="minute">
                {t("scheduledJobs.visual.everyMinutes")}
              </option>
              <option value="hour">
                {t("scheduledJobs.visual.everyHours")}
              </option>
              <option value="daily">{t("scheduledJobs.visual.daily")}</option>
              <option value="weekly">{t("scheduledJobs.visual.weekly")}</option>
              <option value="monthly">
                {t("scheduledJobs.visual.monthly")}
              </option>
            </select>
          </label>

          {["minute", "hour"].includes(config.frequency) && (
            <div className="flex flex-wrap gap-2">
              {(config.frequency === "minute"
                ? MINUTE_INTERVALS
                : HOUR_INTERVALS
              ).map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => update({ interval })}
                  className={`h-10 min-w-12 rounded-lg border px-3 text-sm font-medium transition-[background-color,border-color,color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                    Number(config.interval) === interval
                      ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200 light:text-cyan-800"
                      : "border-white/10 text-theme-text-secondary hover:bg-white/5 hover:text-theme-text-primary light:border-slate-300 light:hover:bg-slate-100"
                  }`}
                >
                  {config.frequency === "minute"
                    ? t("scheduledJobs.visual.minuteValue", { count: interval })
                    : t("scheduledJobs.visual.hourValue", { count: interval })}
                </button>
              ))}
            </div>
          )}

          {config.frequency === "weekly" && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-theme-text-secondary">
                {t("scheduledJobs.visual.weekdays")}
              </span>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((day) => {
                  const active = config.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const weekdays = active
                          ? config.weekdays.filter((item) => item !== day)
                          : [...config.weekdays, day];
                        if (weekdays.length) update({ weekdays });
                      }}
                      className={`h-10 rounded-lg border text-xs font-semibold transition-[background-color,border-color,color,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                        active
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200 light:text-cyan-800"
                          : "border-white/10 text-theme-text-secondary hover:bg-white/5 light:border-slate-300 light:hover:bg-slate-100"
                      }`}
                    >
                      {t(`scheduledJobs.visual.weekday.${day}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {config.frequency === "monthly" && (
            <label className="block space-y-1.5 text-xs font-medium text-theme-text-secondary">
              <span>{t("scheduledJobs.visual.monthDay")}</span>
              <select
                value={config.day}
                onChange={(event) =>
                  update({
                    day:
                      event.target.value === "last"
                        ? "last"
                        : Number(event.target.value),
                  })
                }
                className={`${controlClass} w-full`}
              >
                {Array.from({ length: 31 }, (_, index) => index + 1).map(
                  (day) => (
                    <option key={day} value={day}>
                      {t("scheduledJobs.visual.dayValue", { day })}
                    </option>
                  )
                )}
                <option value="last">
                  {t("scheduledJobs.visual.lastDay")}
                </option>
              </select>
            </label>
          )}

          {["daily", "weekly", "monthly"].includes(config.frequency) && (
            <label className="block space-y-1.5 text-xs font-medium text-theme-text-secondary">
              <span>{t("scheduledJobs.visual.time")}</span>
              <input
                type="time"
                value={config.time}
                onChange={(event) => update({ time: event.target.value })}
                className={`${controlClass} w-full [color-scheme:dark] light:[color-scheme:light]`}
              />
            </label>
          )}
        </>
      )}

      <div
        className={`rounded-lg border p-3 ${
          error
            ? "border-red-400/40 bg-red-400/5"
            : "border-white/10 bg-white/[0.025] light:border-slate-300 light:bg-slate-50"
        }`}
      >
        <div className="flex items-start gap-2">
          <Clock size={17} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-theme-text-primary">
              {scheduleSummary(config, t)}
            </p>
            <p className="mt-1 text-xs text-theme-text-secondary">
              {t("scheduledJobs.visual.timezone", {
                timezone: config.timezone,
              })}
            </p>
            {previews.length > 0 && (
              <p className="mt-2 font-mono text-xs tabular-nums text-theme-text-secondary">
                {t("scheduledJobs.visual.nextRuns")}{" "}
                {previews.map((date) => date.toLocaleString()).join(" · ")}
              </p>
            )}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
