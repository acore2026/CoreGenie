/* eslint-env jest, node */
const { AgentToolContext } = require("../../tools/context");

function createContext(maxToolCalls, { taskId = null, budget = null } = {}) {
  return new AgentToolContext({
    run: {
      configuration: maxToolCalls === undefined ? {} : { maxToolCalls },
    },
    workspace: { id: 1 },
    user: { id: 1 },
    agent: { id: 1 },
    emit: jest.fn(),
    signal: new AbortController().signal,
    taskId,
    budget,
  });
}

describe("AgentToolContext budgets", () => {
  it("defaults the run tool-call budget to 2,500", () => {
    expect(createContext().maxToolCalls).toBe(2_500);
  });

  it("caps a requested run tool-call budget at 2,500", () => {
    expect(createContext(10_000).maxToolCalls).toBe(2_500);
  });

  it("keeps a smaller requested run tool-call budget", () => {
    expect(createContext(400).maxToolCalls).toBe(400);
  });

  it("keeps identical operation counts separate between tasks", () => {
    const budget = { calls: 0, subagentCalls: 0, actionTail: Promise.resolve() };
    const firstTask = createContext(undefined, { taskId: "task-1", budget });
    const secondTask = createContext(undefined, { taskId: "task-2", budget });

    expect(firstTask.recordOperation("same-operation")).toBe(1);
    expect(firstTask.recordOperation("same-operation")).toBe(2);
    expect(secondTask.recordOperation("same-operation")).toBe(1);
  });
});
