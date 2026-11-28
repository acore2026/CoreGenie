import { describe, expect, it } from "vitest";
import {
  diffSeconds,
  formatDateTime,
  formatRelativeTime,
  formatStamp,
} from "@/utils/dateTime";
import { queryKeys } from "@/lib/queryKeys";

describe("dateTime utilities (moment replacement)", () => {
  it("formats timestamp strings cleanly", () => {
    const sample = new Date(2026, 4, 9, 8, 5, 3);
    expect(formatStamp(sample)).toBe("2026-05-09 08:05:03");
    expect(formatDateTime(sample, "YYYY-MM-DD HH:mm:ss")).toBe(
      "2026-05-09 08:05:03"
    );
    expect(formatDateTime(sample, "LTS")).toContain("08:05:03");
  });

  it("computes non-negative elapsed seconds", () => {
    expect(diffSeconds("2026-05-09T08:01:30Z", "2026-05-09T08:00:00Z")).toBe(
      90
    );
    expect(diffSeconds("2026-05-09T08:00:00Z", "2026-05-09T08:01:30Z")).toBe(0);
  });

  it("formats relative times in Simplified Chinese", () => {
    const now = Date.UTC(2026, 4, 9, 8, 0, 0);
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    expect(formatRelativeTime(fiveMinutesAgo, now)).toContain("5");
  });

  it("exposes stable system query keys", () => {
    expect(queryKeys.system.appVersion).toEqual(["system", "appVersion"]);
    expect(queryKeys.system.providerModels("openai")).toEqual([
      "system",
      "providerModels",
      "openai",
    ]);
  });
});
