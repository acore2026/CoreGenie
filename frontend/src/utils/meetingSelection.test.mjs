import { test } from "vitest";
import assert from "node:assert/strict";
import {
  defaultDownloadMeetingId,
  inferAgentMeetings,
  toggleMeeting,
} from "./meetingSelection.ts";

test("infer current and next using sorted dates, not catalogue order", () => {
  const entries = [
    { id: "next", date: "2026-10" },
    { id: "old", date: "2026-08" },
    { id: "current", date: "2026-09" },
    { id: "invalid", date: "2026-99" },
    { id: "unknown" },
  ];
  const result = inferAgentMeetings(entries, new Date(2026, 8, 29));
  assert.equal(result.current.id, "current");
  assert.equal(result.next.id, "next");
  assert.equal(result.today, "2026-09-29");
  assert.equal(entries[0].id, "next");
});

test("full dates distinguish later meetings in the same month and reject invalid days", () => {
  const result = inferAgentMeetings(
    [
      { id: "future", date: "2026-09-30" },
      { id: "today", date: "2026-09-29" },
      { id: "invalid", date: "2026-09-31" },
    ],
    new Date(2026, 8, 29)
  );
  assert.equal(result.current.id, "today");
  assert.equal(result.next.id, "future");
});

test("empty and one-sided catalogues do not invent adjacent meetings", () => {
  assert.equal(inferAgentMeetings([]).current, undefined);
  const entries = [{ id: "one", date: "2026-09" }];
  assert.equal(
    inferAgentMeetings(entries, new Date(2026, 0, 1)).current,
    undefined
  );
  assert.equal(
    inferAgentMeetings(entries, new Date(2026, 11, 1)).next,
    undefined
  );
});

test("deselecting a normal item preserves other normal and manual meetings", () => {
  const one = { id: "one", label: "SA2#176" };
  const two = { id: "two", label: "SA2#177" };
  const manual = { value: "manual:SA2#178", label: "SA2#178" };
  assert.deepEqual(toggleMeeting([one, two, manual], two), [one, manual]);
  assert.deepEqual(toggleMeeting([one, two, manual], manual), [one, two]);
});

test("limit blocks additions but permits deselection; single selection can be replaced", () => {
  const one = { id: "one" };
  const two = { id: "two" };
  assert.deepEqual(toggleMeeting([one], two, { limit: 1 }), [one]);
  assert.deepEqual(toggleMeeting([one], one, { limit: 1 }), []);
  assert.deepEqual(
    toggleMeeting([one], two, { multiple: false, group: "SA2" }),
    [{ ...two, group: "SA2" }]
  );
});

test("month-only meetings may be current in the Agent picker but need an explicit download choice", () => {
  const entries = [
    { id: "last", date: "2026-08", number: 1, suffix: "" },
    { id: "current", date: "2026-09", number: 2, suffix: "" },
    { id: "future", date: "2026-10", number: 3, suffix: "" },
    { id: "unknown", date: null, number: 4, suffix: "" },
    { id: "invalid", date: "2026-02-30", number: 5, suffix: "" },
  ];
  const agent = inferAgentMeetings(entries, new Date(2026, 8, 1));
  assert.equal(agent.current.id, "current");
  assert.equal(agent.next.id, "future");
  assert.equal(defaultDownloadMeetingId(entries, "2026-09-01"), "last");
  assert.equal(defaultDownloadMeetingId(entries.slice(1), "2026-09-01"), "");
});

test("download selection includes today and resolves tied dates by meeting number and suffix", () => {
  const meeting = (id, number, suffix) => ({
    id,
    number,
    suffix,
    date: "2026-09-01",
  });
  const entries = [
    meeting("old", 1, ""),
    meeting("next", 2, "bis"),
    meeting("regular", 2, ""),
  ];
  assert.equal(defaultDownloadMeetingId(entries, "2026-09-01"), "next");
  assert.equal(defaultDownloadMeetingId(entries, "2026-08-31"), "");
});
