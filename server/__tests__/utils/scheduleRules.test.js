/* eslint-env jest, node */
const {
  nextRunAt,
  validateScheduleConfig,
} = require("../../utils/scheduleRules");

describe("visual schedule rules", () => {
  it("converts a one-time local time to UTC", () => {
    const result = validateScheduleConfig(
      {
        type: "once",
        date: "2030-01-02",
        time: "09:30",
        timezone: "Asia/Shanghai",
      },
      { now: new Date("2030-01-01T00:00:00.000Z") }
    );

    expect(result.error).toBeNull();
    expect(result.config.scheduledAt).toBe("2030-01-02T01:30:00.000Z");
  });

  it("calculates daily, weekly, and last-day monthly runs", () => {
    expect(
      nextRunAt(
        {
          type: "recurring",
          frequency: "daily",
          time: "09:00",
          timezone: "Asia/Shanghai",
        },
        new Date("2030-01-01T00:00:00.000Z")
      ).toISOString()
    ).toBe("2030-01-01T01:00:00.000Z");

    expect(
      nextRunAt(
        {
          type: "recurring",
          frequency: "weekly",
          weekdays: [1],
          time: "10:00",
          timezone: "UTC",
        },
        new Date("2030-01-01T11:00:00.000Z")
      ).toISOString()
    ).toBe("2030-01-07T10:00:00.000Z");

    expect(
      nextRunAt(
        {
          type: "recurring",
          frequency: "monthly",
          day: "last",
          time: "12:00",
          timezone: "UTC",
        },
        new Date("2030-02-01T00:00:00.000Z")
      ).toISOString()
    ).toBe("2030-02-28T12:00:00.000Z");
  });

  it("uses an anchor for interval schedules", () => {
    const next = nextRunAt(
      {
        type: "recurring",
        frequency: "minute",
        interval: 15,
        anchorAt: "2030-01-01T00:00:00.000Z",
        timezone: "UTC",
      },
      new Date("2030-01-01T00:31:00.000Z")
    );

    expect(next.toISOString()).toBe("2030-01-01T00:45:00.000Z");
  });

  it("rejects past and nonexistent local times", () => {
    expect(
      validateScheduleConfig(
        {
          type: "once",
          date: "2030-01-01",
          time: "08:00",
          timezone: "UTC",
        },
        { now: new Date("2030-01-01T09:00:00.000Z") }
      ).error
    ).toBe("执行时间必须晚于当前时间。");

    expect(
      validateScheduleConfig(
        {
          type: "once",
          date: "2026-03-08",
          time: "02:30",
          timezone: "America/New_York",
        },
        { now: new Date("2026-03-01T00:00:00.000Z") }
      ).error
    ).toBe("该时间在所选时区中不存在，请重新选择。");
  });
});
