/* eslint-env jest, node */
const {
  DEFAULTS,
  askUserTool,
  controllerDecisionWithFallback,
  createGovernedGraph,
  mergeById,
  normalizedActionPlan,
  requestAllowsWrite,
  resolvedTaskDependencies,
  scopedTaskId,
  streamControllerDecision,
  validatePlan,
} = require("../../agent-system/runtimes/governed");
const { toolRegistry } = require("../../tools");

const context = {
  run: { id: "run-1", prompt: "Research the latest meeting agenda" },
  agent: { id: 1 },
  availableAgents: [{ id: 2 }],
};

describe("Governed Agent runtime", () => {
  it("provides enough bounded budget for multi-document Skills", () => {
    expect(DEFAULTS.maxTaskToolCalls).toBe(100);
    expect(DEFAULTS.maxTaskModelCalls).toBe(100);
    expect(DEFAULTS.maxTaskMs).toBe(20 * 60 * 1_000);
  });

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

  it("always permits framework Skill tools for Skill-bound Agents", () => {
    const plan = validatePlan(
      {
        goal: "activate the bound skill",
        tasks: [
          {
            id: "activate",
            title: "Activate Skill",
            objective: "Activate and follow the bound Skill",
            allowedToolIds: ["skill.activate", "skill.read_resource"],
          },
        ],
      },
      { ...context, agent: { id: 1, tools: ["bash"] } }
    );

    expect(plan.tasks[0].allowedToolIds).toEqual([
      "skill.activate",
      "skill.read_resource",
    ]);
  });

  it("keeps skill-permitted tools available after normalized activation", () => {
    const plan = normalizedActionPlan({
      descriptor: toolRegistry.get("skill.activate"),
      args: {},
      request: "List the KI8 documents",
      agent: { id: 1, tools: null },
      skills: [
        {
          name: "3gpp-tdocs",
          allowedTools:
            "skill.activate skill.read_resource bash python web.fetch",
        },
      ],
    });

    expect(plan.tasks[0].allowedToolIds).toEqual(
      expect.arrayContaining([
        "skill.activate",
        "skill.read_resource",
        "bash",
        "python",
        "web.fetch",
      ])
    );
    expect(plan.tasks[0].successCriteria.join(" ")).toMatch(
      /instead of stopping after activation/i
    );
  });

  it("does not let a skill expand beyond the selected Agent tool policy", () => {
    const plan = normalizedActionPlan({
      descriptor: toolRegistry.get("skill.activate"),
      args: { name: "3gpp-tdocs" },
      request: "Inspect the meeting index",
      agent: { id: 1, tools: ["web-browsing"] },
      skills: [
        {
          name: "3gpp-tdocs",
          allowedTools: "bash python web.fetch",
        },
      ],
    });

    expect(plan.tasks[0].allowedToolIds).toContain("web.fetch");
    expect(plan.tasks[0].allowedToolIds).not.toContain("bash");
    expect(plan.tasks[0].allowedToolIds).not.toContain("python");
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

  it("waits until every task dependency has a result", () => {
    const task = { dependsOn: ["a", "b"] };
    const pending = new Map([["a", { id: "a", status: "completed" }]]);
    expect(resolvedTaskDependencies(task, pending)).toBeNull();

    const complete = new Map([
      ["a", { id: "a", status: "completed" }],
      ["b", { id: "b", status: "failed" }],
    ]);
    expect(resolvedTaskDependencies(task, complete)).toEqual([
      { id: "a", status: "completed" },
      { id: "b", status: "failed" },
    ]);
  });

  it("requires exactly three choices for user confirmations", () => {
    const schema = askUserTool().schema;
    expect(
      schema.safeParse({
        question: "Which download scope should I use?",
        choices: ["Latest only", "All versions", "Baseline only"],
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        question: "Which download scope should I use?",
        choices: ["Latest only", "All versions"],
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        question: "Which download scope should I use?",
        choices: ["Latest", "All", "Baseline", "Other"],
      }).success
    ).toBe(false);
  });

  it("retains streamed controller text when the merged content is empty", async () => {
    async function* chunks() {
      yield {
        content: "download ",
        concat: () => ({ content: "", tool_calls: [] }),
      };
      yield { content: "complete" };
    }
    const onToken = jest.fn();
    const decision = await streamControllerDecision(
      { stream: jest.fn().mockResolvedValue(chunks()) },
      [{ role: "user", content: "download" }],
      { onToken, streamOptions: {} }
    );

    expect(decision.response).toBe("download complete");
    expect(decision.streamedDirect).toBe(true);
    expect(onToken.mock.calls.flat()).toEqual(["download ", "complete"]);
  });

  it("retries an empty controller response with the fallback model", async () => {
    async function* emptyChunks() {
      yield {
        content: "",
        additional_kwargs: { reasoning_content: "unfinished reasoning" },
      };
    }
    async function* fallbackChunks() {
      yield { content: "visible answer" };
    }
    const emit = jest.fn();
    const onToken = jest.fn();
    const createFallbackModel = jest.fn(() => ({
      stream: jest.fn().mockResolvedValue(fallbackChunks()),
    }));
    const decision = await controllerDecisionWithFallback({
      primaryModel: {
        stream: jest.fn().mockResolvedValue(emptyChunks()),
      },
      createFallbackModel,
      messages: [{ role: "user", content: "download" }],
      onToken,
      emit,
      primaryStreamOptions: {},
      fallbackStreamOptions: {},
    });

    expect(decision.response).toBe("visible answer");
    expect(createFallbackModel).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("model.fallback", {
      role: "controller",
      reason: "empty_visible_response",
      thinking: false,
    });
    expect(emit).toHaveBeenCalledWith("activity.updated", {
      phase: "planning",
      summary: "Retrying with a standard visible response",
      summaryKey: "retrying_visible_response",
    });
    expect(onToken).toHaveBeenCalledWith("visible answer");
  });
});
