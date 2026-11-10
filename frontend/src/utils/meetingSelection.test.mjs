import test from "node:test";
import assert from "node:assert/strict";
import { inferMeetings, toggleMeeting } from "./meetingSelection.mjs";

test("infer current and next using sorted dates, not catalogue order", () => {
  const entries = [
    { id: "next", date: "2026-10" },
    { id: "old", date: "2026-08" },
    { id: "current", date: "2026-09" },
    { id: "invalid", date: "2026-99" },
    { id: "unknown" },
  ];
  const result = inferMeetings(entries, new Date(2026, 8, 29));
  assert.equal(result.current.id, "current");
  assert.equal(result.next.id, "next");
  assert.equal(result.today, "2026-09-29");
  assert.equal(entries[0].id, "next");
});

test("full dates distinguish later meetings in the same month and reject invalid days", () => {
  const result = inferMeetings(
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
  assert.equal(inferMeetings([]).current, undefined);
  const entries = [{ id: "one", date: "2026-09" }];
  assert.equal(inferMeetings(entries, new Date(2026, 0, 1)).current, undefined);
  assert.equal(inferMeetings(entries, new Date(2026, 11, 1)).next, undefined);
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
