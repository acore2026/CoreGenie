import { test } from "vitest";
import assert from "node:assert/strict";
import { completedTimeline } from "./reactTimeline.ts";
const parts = [
  { type: "text", text: "准备下载" },
  { type: "toolGroup", callIds: ["a"] },
  { type: "text", text: "资料已读" },
  { type: "toolGroup", callIds: ["b"] },
  { type: "text", text: "最终结果" },
  { type: "text", text: "下载链接" },
];
test("all final answer blocks remain visible and earlier commentary stays in history", () => {
  const result = completedTimeline(parts, "completed");
  assert.ok(result);
  assert.equal(result.answer, "最终结果\n\n下载链接");
  assert.deepEqual(result.history, parts.slice(0, 4));
  assert.equal(parts.length, 6);
});
test("active, partial, failed, cancelled and unknown runs never auto-fold", () => {
  for (const status of [
    undefined,
    "running",
    "queued",
    "partial",
    "failed",
    "cancelled",
    "waiting_for_input",
    "waiting_for_approval",
  ])
    assert.equal(completedTimeline(parts, status), null);
});
test("a run without a final answer does not hide its only text", () => {
  assert.equal(
    completedTimeline(parts.slice(0, 4), "completed", "all streamed text", 2),
    null
  );
  assert.equal(
    completedTimeline([{ type: "text", text: "直接回答" }], "completed"),
    null
  );
});
test("legacy tool history folds without losing saved answer", () => {
  assert.deepEqual(completedTimeline([], "completed", "历史回答", 2), {
    history: [],
    answer: "历史回答",
  });
  assert.equal(completedTimeline([], "completed", "", 2), null);
});
