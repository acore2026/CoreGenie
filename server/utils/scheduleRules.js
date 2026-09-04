const VALID_FREQUENCIES = new Set([
  "minute",
  "hour",
  "daily",
  "weekly",
  "monthly",
]);

const formatterCache = new Map();

function formatter(timezone) {
  if (!formatterCache.has(timezone)) {
    formatterCache.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
    );
  }
  return formatterCache.get(timezone);
}

function validTimezone(value) {
  try {
    formatter(value).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date, timezone) {
  const parts = Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function sameLocalDateTime(left, right) {
  return ["year", "month", "day", "hour", "minute"].every(
    (key) => left[key] === right[key]
  );
}

function zonedDateTimeToUtc(local, timezone) {
  const target = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    0,
    0
  );
  let guess = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second || 0
    );
    const next = guess + (target - actualAsUtc);
    if (next === guess) break;
    guess = next;
  }
  const result = new Date(guess);
  return sameLocalDateTime(zonedParts(result, timezone), local) ? result : null;
}

function parseTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, value: `${match[1]}:${match[2]}` };
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  )
    return null;
  return { year, month, day, value: String(value) };
}

function localDateFromUtcDate(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function shiftLocalDate(local, days) {
  return localDateFromUtcDate(
    new Date(Date.UTC(local.year, local.month - 1, local.day + days))
  );
}

function shiftLocalMonth(local, months) {
  return localDateFromUtcDate(
    new Date(Date.UTC(local.year, local.month - 1 + months, 1))
  );
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekday(local) {
  return new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
}

function nextWallClock(config, after) {
  const timezone = config.timezone;
  const time = parseTime(config.time);
  const localAfter = zonedParts(after, timezone);
  const startDate = {
    year: localAfter.year,
    month: localAfter.month,
    day: localAfter.day,
  };

  if (config.frequency === "daily") {
    for (let offset = 0; offset < 370; offset += 1) {
      const date = shiftLocalDate(startDate, offset);
      const candidate = zonedDateTimeToUtc({ ...date, ...time }, timezone);
      if (candidate && candidate.getTime() > after.getTime()) return candidate;
    }
  }

  if (config.frequency === "weekly") {
    const selected = new Set(config.weekdays);
    for (let offset = 0; offset < 370; offset += 1) {
      const date = shiftLocalDate(startDate, offset);
      if (!selected.has(weekday(date))) continue;
      const candidate = zonedDateTimeToUtc({ ...date, ...time }, timezone);
      if (candidate && candidate.getTime() > after.getTime()) return candidate;
    }
  }

  if (config.frequency === "monthly") {
    const monthStart = { ...startDate, day: 1 };
    for (let offset = 0; offset < 36; offset += 1) {
      const month = shiftLocalMonth(monthStart, offset);
      const lastDay = daysInMonth(month.year, month.month);
      const day = config.day === "last" ? lastDay : Number(config.day);
      if (day > lastDay) continue;
      const candidate = zonedDateTimeToUtc(
        { ...month, day, ...time },
        timezone
      );
      if (candidate && candidate.getTime() > after.getTime()) return candidate;
    }
  }

  return null;
}

function nextRunAt(config, after = new Date()) {
  const normalizedAfter = new Date(after);
  if (!config || Number.isNaN(normalizedAfter.getTime())) return null;
  if (config.type === "once") {
    const scheduledAt = new Date(config.scheduledAt);
    return Number.isNaN(scheduledAt.getTime()) ? null : scheduledAt;
  }
  if (config.frequency === "minute" || config.frequency === "hour") {
    const unit = config.frequency === "minute" ? 60_000 : 3_600_000;
    const intervalMs = Number(config.interval) * unit;
    const anchor = new Date(config.anchorAt || normalizedAfter);
    if (!intervalMs || Number.isNaN(anchor.getTime())) return null;
    if (anchor.getTime() > normalizedAfter.getTime()) return anchor;
    const elapsed = normalizedAfter.getTime() - anchor.getTime();
    return new Date(
      anchor.getTime() + (Math.floor(elapsed / intervalMs) + 1) * intervalMs
    );
  }
  return nextWallClock(config, normalizedAfter);
}

function validateScheduleConfig(value, { now = new Date() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { config: null, error: "请选择执行时间。" };
  const type = value.type;
  const timezone = String(value.timezone || "").trim();
  if (!validTimezone(timezone))
    return { config: null, error: "无法识别所选时区。" };

  if (type === "once") {
    const date = parseDate(value.date);
    const time = parseTime(value.time);
    if (!date || !time)
      return { config: null, error: "请选择有效的日期和时间。" };
    const scheduledAt = zonedDateTimeToUtc(
      { ...date, hour: time.hour, minute: time.minute },
      timezone
    );
    if (!scheduledAt)
      return { config: null, error: "该时间在所选时区中不存在，请重新选择。" };
    if (scheduledAt.getTime() <= new Date(now).getTime())
      return { config: null, error: "执行时间必须晚于当前时间。" };
    return {
      config: {
        type: "once",
        date: date.value,
        time: time.value,
        timezone,
        scheduledAt: scheduledAt.toISOString(),
      },
      error: null,
    };
  }

  if (type !== "recurring" || !VALID_FREQUENCIES.has(value.frequency))
    return { config: null, error: "请选择重复方式。" };

  if (["minute", "hour"].includes(value.frequency)) {
    const allowed =
      value.frequency === "minute"
        ? [1, 2, 5, 10, 15, 20, 30]
        : [1, 2, 4, 6, 8, 12];
    const interval = Number(value.interval);
    if (!allowed.includes(interval))
      return { config: null, error: "请选择有效的执行间隔。" };
    const anchorAt = value.anchorAt ? new Date(value.anchorAt) : new Date(now);
    return {
      config: {
        type: "recurring",
        frequency: value.frequency,
        interval,
        timezone,
        anchorAt: Number.isNaN(anchorAt.getTime())
          ? new Date(now).toISOString()
          : anchorAt.toISOString(),
      },
      error: null,
    };
  }

  const time = parseTime(value.time);
  if (!time) return { config: null, error: "请选择有效的执行时间。" };
  const config = {
    type: "recurring",
    frequency: value.frequency,
    time: time.value,
    timezone,
  };
  if (value.frequency === "weekly") {
    const weekdays = [
      ...new Set(
        (Array.isArray(value.weekdays) ? value.weekdays : [])
          .map(Number)
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      ),
    ].sort((a, b) => a - b);
    if (!weekdays.length)
      return { config: null, error: "请至少选择一个星期。" };
    config.weekdays = weekdays;
  }
  if (value.frequency === "monthly") {
    const day = value.day === "last" ? "last" : Number(value.day);
    if (day !== "last" && (!Number.isInteger(day) || day < 1 || day > 31))
      return { config: null, error: "请选择有效的月份日期。" };
    config.day = day;
  }
  if (!nextRunAt(config, new Date(now)))
    return { config: null, error: "无法计算下一次执行时间。" };
  return { config, error: null };
}

module.exports = {
  nextRunAt,
  validateScheduleConfig,
  validTimezone,
  zonedDateTimeToUtc,
  zonedParts,
};
