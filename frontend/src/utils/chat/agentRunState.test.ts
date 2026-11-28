import assert from "node:assert/strict";
import { test } from "vitest";
import { legacyEventFromAgentRun } from "./agentLegacyEvent.ts";
import { reduceAgentRunState } from "./agentRunState.ts";

import type { AgentRunState, RunPayload } from "./agentRunTypes";
const runId = "example-run";
function events<const T extends { type: string; payload: RunPayload }>(
  entries: T[]
) {
  return entries.map((entry, index) => ({
    id: index + 1,
    ...entry,
    runId,
    createdAt: "2026-01-01T00:00:00Z",
  }));
}

test("live SSE and a stored run rebuild the same tasks, messages and resource traces", () => {
  const stream = events([
    { type: "run.started", payload: { runtime: { key: "governed-agent" } } },
    {
      type: "plan.created",
      payload: { tasks: [{ id: "draft", title: "Draft" }] },
    },
    { type: "task.started", payload: { taskId: "draft" } },
    { type: "skill.activated", payload: { name: "writer" } },
    {
      type: "skill.resource.used",
      payload: { name: "writer", path: "references/guide.md" },
    },
    {
      type: "tool.started",
      payload: { callId: "call", groupId: "tools", toolId: "read" },
    },
    {
      type: "tool.failed",
      payload: {
        callId: "call",
        groupId: "tools",
        toolId: "read",
        code: "NO_PROGRESS",
        reason: "unchanged",
      },
    },
    {
      type: "message.delta",
      payload: { messageId: "message", partId: "text", delta: "first" },
    },
    {
      type: "message.delta",
      payload: { messageId: "message", partId: "text", partDelta: " second" },
    },
    { type: "task.completed", payload: { taskId: "draft" } },
    { type: "run.partial", payload: { outputs: ["draft.md"] } },
  ]);
  const initial = { runId };
  const live = stream.reduce<Partial<AgentRunState>>((state, envelope) => {
    const adapted = legacyEventFromAgentRun(envelope);
    assert.ok(
      adapted?.type === "reportStreamEvent" || adapted?.type === "agentRunEvent"
    );
    const event =
      adapted.type === "reportStreamEvent"
        ? adapted.content.agentRunEvent
        : adapted.content.event;
    assert.ok(event);
    return reduceAgentRunState(state, event);
  }, initial);
  assert.deepEqual(
    live,
    stream.reduce<Partial<AgentRunState>>(reduceAgentRunState, initial)
  );
  assert.equal(live.tasks?.[0].status, "completed");
  assert.equal(live.toolExecutions?.[0].status, "skipped");
  assert.equal(live.resourceTraces?.length, 1);
  assert.deepEqual(live.messageParts, [
    { id: "tools", type: "toolGroup", callIds: ["call"] },
    { id: "text", type: "text", text: "first second" },
  ]);
  assert.deepEqual(live.outputs, ["draft.md"]);
});

test("input resolution resumes work and a terminal failure preserves the error", () => {
  const stream = events([
    { type: "task.created", payload: { task: { id: "t" } } },
    { type: "input.requested", payload: { requestId: "one" } },
    { type: "input.resolved", payload: { requestId: "one" } },
    { type: "run.failed", payload: { error: "connection lost" } },
  ]);
  const paused = stream
    .slice(0, 2)
    .reduce<Partial<AgentRunState>>(reduceAgentRunState, {});
  assert.equal(paused.status, "waiting_for_input");
  const resumed = reduceAgentRunState(paused, stream[2]);
  assert.equal(resumed.phase, "resuming");
  const failed = reduceAgentRunState(resumed, stream[3]);
  assert.equal(failed.tasks[0].error, "connection lost");
  assert.equal(resumed.tasks[0].status, "pending");
});

test("older socket messages, approvals and completed messages keep their wire format", () => {
  const old = { type: "textResponse" as const, content: "hello" };
  assert.equal(legacyEventFromAgentRun(old), old);
  const [approval, complete, unknown] = events([
    {
      type: "approval.requested",
      payload: {
        requestId: "a",
        actionRequests: [{ name: "read", args: { id: 2 } }],
      },
    },
    {
      type: "message.completed",
      payload: { messageId: "m", chatId: 7, parts: [] },
    },
    { type: "unknown.event", payload: {} },
  ]).map(legacyEventFromAgentRun);
  assert.ok(approval?.type === "toolApprovalRequest");
  assert.ok(complete?.type === "reportStreamEvent");
  assert.equal(approval.skillName, "read");
  assert.deepEqual(approval.payload, { id: 2 });
  assert.equal(complete.content.chatId, 7);
  assert.equal(unknown, null);
});
