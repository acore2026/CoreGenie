import test from "node:test";
import assert from "node:assert/strict";
import { conversationPlanRuns, planTasks } from "./taskPlan.mjs";

test("latest run stays first and assistant messages retain live execution state", () => {
  const live = {
    runtimeKey: "default-react",
    status: "running",
    tasks: [{ id: "b:plan:1" }],
  };
  const result = conversationPlanRuns([
    { agentRunId: "a", runtime: { key: "default-react" } },
    { agentRunId: "b", type: "agentExecution", agentRunState: live },
    { agentRunId: "b", role: "assistant" },
    { agentRunId: "child", type: "subagentRun" },
  ]);
  assert.deepEqual(
    result.map((run) => run.id),
    ["b", "a"]
  );
  assert.equal(result[0].state, live);
});

test("new conversation cannot reuse another conversation's plan", () => {
  assert.deepEqual(
    conversationPlanRuns([{ role: "user", content: "new task" }]),
    []
  );
  assert.deepEqual(
    conversationPlanRuns([{ agentRunId: "new", role: "assistant" }]),
    [{ id: "new", state: null, runtimeKey: undefined }]
  );
});

test("runtime plan excludes execution scaffolding and sorts without mutating tasks", () => {
  const tasks = [
    { id: "r:plan:2", budget: { planOrder: 2 }, status: "cancelled" },
    { id: "r:execute", status: "running" },
    { id: "r:plan:1", budget: { planOrder: 1 }, status: "completed" },
  ];
  assert.deepEqual(
    planTasks(tasks, "default-react").map((task) => task.id),
    ["r:plan:1", "r:plan:2"]
  );
  assert.deepEqual(
    planTasks(tasks, "other").map((task) => task.id),
    ["r:execute"]
  );
  assert.equal(tasks[0].id, "r:plan:2");
});
