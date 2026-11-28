export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? new Date() : value;
  if (value === null || value === undefined || value === "") return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function pad2(num: number): string {
  return String(num).padStart(2, "0");
}

export function formatStamp(value?: DateInput): string {
  const date = toDate(value);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

export function formatDateTime(value?: DateInput, format = "LLL"): string {
  const date = toDate(value);
  if (format === "YYYY-MM-DD HH:mm:ss") return formatStamp(date);
  if (format === "LTS") {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }
  if (format === "lll") {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatRelativeTime(
  value: DateInput,
  nowMs = Date.now()
): string {
  const date = toDate(value);
  const diffSeconds = Math.round((date.getTime() - nowMs) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

  if (absSeconds < 45) return rtf.format(diffSeconds, "second");
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 45) return rtf.format(diffMinutes, "minute");
  const diffHours = Math.round(diffSeconds / 3600);
  if (Math.abs(diffHours) < 22) return rtf.format(diffHours, "hour");
  const diffDays = Math.round(diffSeconds / 86400);
  if (Math.abs(diffDays) < 26) return rtf.format(diffDays, "day");
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 11) return rtf.format(diffMonths, "month");
  const diffYears = Math.round(diffDays / 365);
  return rtf.format(diffYears, "year");
}

export function diffSeconds(end: DateInput, start: DateInput): number {
  const endTime = toDate(end).getTime();
  const startTime = toDate(start).getTime();
  return Math.max(0, (endTime - startTime) / 1000);
}
