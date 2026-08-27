/* eslint-env jest, node */
const {
  createGovernedGraph,
  mergeById,
  requestAllowsWrite,
  scopedTaskId,
  validatePlan,
} = require("../../agent-system/runtimes/governed");

const context = {
  run: { id: "run-1", prompt: "Research the latest meeting agenda" },
  agent: { id: 1 },
  availableAgents: [{ id: 2 }],
};

describe("Governed Agent runtime", () => {
  it("compiles without state-channel and node-name collisions", () => {
    expect(() =>
      createGovernedGraph({
        run: { id: "run-compile", configuration: {}, runtimeSnapshot: {} },
        workspace: { id: 1 },
        user: { id: 1 },
        thread: null,
        agent: { id: 1, systemPrompt: "" },
        emit: jest.fn(),
        signal: new AbortController().signal,
        runnableConfig: {},
        onToken: jest.fn(),
      })
    ).not.toThrow();
  });

  it("validates and scopes a dependency-aware plan", () => {
    const plan = validatePlan(
      {
        goal: "Verify the meeting",
        tasks: [
          {
            id: "find",
            title: "Find meeting records",
            objective: "Find the primary meeting record",
            allowedToolIds: ["web.fetch"],
          },
          {
            id: "verify",
            title: "Verify dates",
            objective: "Verify dates against the record",
            dependsOn: ["find"],
            assignedAgentId: 2,
          },
        ],
      },
      context
    );
    expect(plan.tasks[0].id).toBe(scopedTaskId("run-1", "find"));
    expect(plan.tasks[1].dependsOn).toEqual([scopedTaskId("run-1", "find")]);
  });

  it("rejects cycles, unavailable Agents, and final-answer worker tasks", () => {
    expect(() =>
      validatePlan(
        {
          goal: "cycle",
          tasks: [
            { id: "a", title: "A", objective: "Check A", dependsOn: ["b"] },
            { id: "b", title: "B", objective: "Check B", dependsOn: ["a"] },
          ],
        },
        context
      )
    ).toThrow(/cycle/);
    expect(() =>
      validatePlan(
        {
          goal: "delegate",
          tasks: [
            {
              id: "a",
              title: "A",
              objective: "Check A",
              assignedAgentId: 999,
            },
          ],
        },
        context
      )
    ).toThrow(/unavailable Agent/);
    expect(() =>
      validatePlan(
        {
          goal: "answer",
          tasks: [
            {
              id: "a",
              title: "Answer",
              objective: "Write the final answer to the user",
            },
          ],
        },
        context
      )
    ).toThrow(/Final answer synthesis/);
  });

  it("rejects tools outside the selected Agent policy", () => {
    expect(() =>
      validatePlan(
        {
          goal: "run code",
          tasks: [
            {
              id: "run",
              title: "Run code",
              objective: "Run the requested code",
              allowedToolIds: ["bash"],
            },
          ],
        },
        { ...context, agent: { id: 1, tools: ["rag-memory"] } }
      )
    ).toThrow(/disallowed tool bash/);
  });

  it("removes undeclared write intent and merges task updates by ID", () => {
    const plan = validatePlan(
      {
        goal: "read",
        tasks: [
          {
            id: "a",
            title: "Read",
            objective: "Inspect the workspace",
            writeIntent: true,
          },
        ],
      },
      context
    );
    expect(plan.tasks[0].writeIntent).toBe(false);
    expect(requestAllowsWrite("Please edit the workspace file")).toBe(true);
    expect(
      mergeById(
        [{ id: "a", status: "running" }],
        [{ id: "a", status: "completed" }]
      )
    ).toEqual([{ id: "a", status: "completed" }]);
  });
});
