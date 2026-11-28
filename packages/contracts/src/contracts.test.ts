import { describe, expect, it } from "vitest";
import {
  meetingCatalog,
  meetingError,
  officialMeeting,
} from "./index.mts";

describe("@coregenie/contracts meetingLists schemas", () => {
  const sampleMeeting = {
    id: "TSGS2_175_Bangkok",
    number: 175,
    suffix: "",
    label: "SA2#175",
    date: "2026-04-13",
    year: 2026,
    source: "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/TSGS2_175_Bangkok/",
  };

  it("parses valid official meeting metadata", () => {
    const parsed = officialMeeting.safeParse(sampleMeeting);
    expect(parsed.success).toBe(true);
  });

  it("parses meeting catalog responses", () => {
    const parsed = meetingCatalog.safeParse({
      group: "SA2",
      source: "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/",
      meetings: [sampleMeeting],
      fetchedAt: "2026-04-13T08:00:00Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses meeting error payloads", () => {
    const parsed = meetingError.safeParse({
      error: "找不到指定会议目录",
    });
    expect(parsed.success).toBe(true);
  });
});
