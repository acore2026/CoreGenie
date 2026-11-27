import assert from "node:assert/strict";
import { test } from "vitest";
import { legacyEventFromAgentRun } from "./agentLegacyEvent.ts";
import { reduceAgentRunState } from "./agentRunState.ts";

const runId = "example-run";
function events(entries) {
  return entries.map(([type, payload], index) => ({
    id: index + 1,
    type,
    payload,
    runId,
    createdAt: "2026-01-01T00:00:00Z",
  }));
}

test("live SSE and a stored run rebuild the same tasks, messages and resource traces", () => {
  const stream = events([
    ["run.started", { runtime: { key: "governed-agent" } }],
    ["plan.created", { tasks: [{ id: "draft", title: "Draft" }] }],
    ["task.started", { taskId: "draft" }],
    ["skill.activated", { name: "writer" }],
    ["skill.resource.used", { name: "writer", path: "references/guide.md" }],
    ["tool.started", { callId: "call", groupId: "tools", toolId: "read" }],
    [
      "tool.failed",
      {
        callId: "call",
        groupId: "tools",
        toolId: "read",
        code: "NO_PROGRESS",
        reason: "unchanged",
      },
    ],
    ["message.delta", { messageId: "message", partId: "text", delta: "first" }],
    [
      "message.delta",
      { messageId: "message", partId: "text", partDelta: " second" },
    ],
    ["task.completed", { taskId: "draft" }],
    ["run.partial", { outputs: ["draft.md"] }],
  ]);
  const initial = { runId };
  const live = stream.reduce((state, envelope) => {
    const adapted = legacyEventFromAgentRun(envelope);
    return reduceAgentRunState(
      state,
      adapted.content.agentRunEvent ?? adapted.content.event
    );
  }, initial);
  assert.deepEqual(live, stream.reduce(reduceAgentRunState, initial));
  assert.equal(live.tasks[0].status, "completed");
  assert.equal(live.toolExecutions[0].status, "skipped");
  assert.equal(live.resourceTraces.length, 1);
  assert.deepEqual(live.messageParts, [
    { id: "tools", type: "toolGroup", callIds: ["call"] },
    { id: "text", type: "text", text: "first second" },
  ]);
  assert.deepEqual(live.outputs, ["draft.md"]);
});

test("input resolution resumes work and a terminal failure preserves the error", () => {
  const stream = events([
    ["task.created", { task: { id: "t" } }],
    ["input.requested", { requestId: "one" }],
    ["input.resolved", { requestId: "one" }],
    ["run.failed", { error: "connection lost" }],
  ]);
  const paused = stream.slice(0, 2).reduce(reduceAgentRunState, {});
  assert.equal(paused.status, "waiting_for_input");
  const resumed = reduceAgentRunState(paused, stream[2]);
  assert.equal(resumed.phase, "resuming");
  const failed = reduceAgentRunState(resumed, stream[3]);
  assert.equal(failed.tasks[0].error, "connection lost");
  assert.equal(resumed.tasks[0].status, "pending");
});

test("older socket messages, approvals and completed messages keep their wire format", () => {
  const old = { type: "textResponse", content: "hello" };
  assert.equal(legacyEventFromAgentRun(old), old);
  const [approval, complete, unknown] = events([
    [
      "approval.requested",
      { requestId: "a", actionRequests: [{ name: "read", args: { id: 2 } }] },
    ],
    ["message.completed", { messageId: "m", chatId: 7, parts: [] }],
    ["unknown.event", {}],
  ]).map(legacyEventFromAgentRun);
  assert.equal(approval.skillName, "read");
  assert.deepEqual(approval.payload, { id: 2 });
  assert.equal(complete.content.chatId, 7);
  assert.equal(unknown, null);
});
