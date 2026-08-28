/* eslint-env jest, node */
const {
  DEFAULTS,
  askUserTool,
  controllerDecisionWithFallback,
  classify3gppRequest,
  createGovernedGraph,
  isSkillBootstrapTask,
  mergeById,
  normalized3gppLookupPlan,
  normalizedActionPlan,
  parse3gppInvitationFacts,
  parse3gppMeetingRequest,
  quick3gppResponse,
  requestAllowsWrite,
  resolvedTaskDependencies,
  scopedTaskId,
  streamControllerDecision,
  skillBootstrapCompletion,
  taskRequiredCompletionTools,
  validatePlan,
  workerContinuationInstruction,
} = require("../../agent-system/runtimes/governed");
const { taskSelectionAllows, toolRegistry } = require("../../tools");

const context = {
  run: { id: "run-1", prompt: "Research the latest meeting agenda" },
  agent: { id: 1 },
  availableAgents: [{ id: 2 }],
};

describe("Governed Agent runtime", () => {
  it("provides enough bounded budget for multi-document Skills", () => {
    expect(DEFAULTS.maxTaskToolCalls).toBe(500);
    expect(DEFAULTS.maxTaskModelCalls).toBe(500);
    expect(DEFAULTS.maxTaskMs).toBe(100 * 60 * 1_000);
    expect(DEFAULTS.maxRunMs).toBe(150 * 60 * 1_000);
    expect(DEFAULTS.maxQuickLookupToolCalls).toBe(12);
    expect(DEFAULTS.maxQuickLookupModelCalls).toBe(8);
  });

  it("routes only simple 3GPP meeting facts to the quick lookup", () => {
    expect(classify3gppRequest("SA2#175 是什么时候的会议？")).toBe(
      "3gpp_fact_lookup"
    );
    expect(classify3gppRequest("SA2#175 在哪里举行？")).toBe(
      "3gpp_fact_lookup"
    );
    expect(
      classify3gppRequest("下载 SA2#175 KI#22 中 Huawei 的提案")
    ).toBe("general");
    expect(classify3gppRequest("分析 SA2#175 的提案并生成报告")).toBe(
      "general"
    );
  });

  it("extracts official meeting dates and formats a direct answer", () => {
    const invitation =
      "SA2#175 Meetings from Monday 18 to Friday 22 of May 2026 in Dalian, China";
    expect(parse3gppMeetingRequest("SA2#175 是什么时候？")).toEqual({
      group: "SA2",
      meetingNumber: 175,
    });
    expect(parse3gppInvitationFacts(invitation)).toMatchObject({
      year: 2026,
      month: 5,
      startDay: 18,
      endDay: 22,
      city: "Dalian",
      country: "China",
    });
    const response = quick3gppResponse({
        meeting: { group: "SA2", meetingNumber: 175 },
        data: {
          candidates: [
            {
              folder: "TSGS2_175_Dalian_2026-05",
              url: "https://www.3gpp.org/meeting",
            },
          ],
          officialDetails: {
            invitationUrl: "https://www.3gpp.org/invitation.pdf",
            invitationText: invitation,
          },
        },
      }).text;
    expect(response).toContain("2026 年 5 月 18 日至 22 日");
    expect(response).toContain("地点为中国大连");
  });

  it("builds a single read-only task for quick 3GPP facts", () => {
    const plan = normalized3gppLookupPlan(
      "SA2#175 是什么时候？",
      new Set(["skill.activate", "3gpp.resolve-meeting", "web.fetch"])
    );

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      writeIntent: false,
      allowedToolIds: [
        "skill.activate",
        "3gpp.resolve-meeting",
        "web.fetch",
      ],
    });
    expect(plan.tasks[0].allowedToolIds).not.toEqual(
      expect.arrayContaining(["bash", "python", "filesystem.write"])
    );
  });

  it("does not repeat tools when only the worker result format is invalid", () => {
    const instruction = workerContinuationInstruction({
      reasons: ["The previous response was not valid JSON."],
      missingToolIds: [],
      completedToolIds: ["3gpp.resolve-meeting"],
    });

    expect(instruction).toMatch(/Do not call any tool again/);
    expect(instruction).toMatch(/Return exactly one JSON object/);
    expect(instruction).not.toMatch(/begin with the tool calls needed/);
  });

  it("requires completion tools only in tasks that are allowed to call them", () => {
    const run = {
      runtimeSnapshot: {
        runtimeConfig: { requiredCompletionTools: ["knowledge.publish"] },
      },
    };

    expect(
      taskRequiredCompletionTools(run, [
        "skill.activate",
        "skill.read_resource",
      ])
    ).toEqual([]);
    expect(
      taskRequiredCompletionTools(run, ["filesystem.read", "knowledge.publish"])
    ).toEqual(["knowledge.publish"]);
  });

  it("recognizes a completed Skill bootstrap from durable tool records", () => {
    const task = {
      title: "Skill bootstrap",
      objective:
        "Activate demo-skill and read status-semantics and company-aliases.",
      allowedToolIds: ["skill.activate", "skill.read_resource"],
    };
    const skills = [
      {
        name: "demo-skill",
        files: [
          { path: "SKILL.md", text: true },
          { path: "references/status-semantics.md", text: true },
          { path: "references/company-aliases.json", text: true },
        ],
      },
    ];
    const executions = [
      {
        status: "completed",
        tool_id: "skill.activate",
        arguments: { name: "demo-skill" },
      },
      {
        status: "completed",
        tool_id: "skill.read_resource",
        arguments: {
          name: "demo-skill",
          path: "references/status-semantics.md",
        },
        result: {
          data: {
            path: "references/status-semantics.md",
            nextOffset: null,
          },
        },
      },
      {
        status: "completed",
        tool_id: "skill.read_resource",
        arguments: {
          name: "demo-skill",
          path: "references/company-aliases.json",
        },
        result: {
          data: {
            path: "references/company-aliases.json",
            nextOffset: null,
          },
        },
      },
    ];

    expect(isSkillBootstrapTask(task)).toBe(true);
    expect(skillBootstrapCompletion(task, skills, executions)).toMatchObject({
      complete: true,
      missingSkills: [],
      missingResources: [],
    });
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

  it("keeps Skill tools implicit normally but honors strict task overrides", () => {
    const allowed = new Set(["filesystem.read"]);
    const skillTool = { id: "skill.activate", name: "activate_skill" };

    expect(taskSelectionAllows(allowed, skillTool, false)).toBe(true);
    expect(taskSelectionAllows(allowed, skillTool, true)).toBe(false);
    expect(
      taskSelectionAllows(new Set(["skill.activate"]), skillTool, true)
    ).toBe(true);
  });

  it("splits direct 3GPP Skill activation into dependent workflow phases", () => {
    const plan = normalizedActionPlan({
      descriptor: toolRegistry.get("skill.activate"),
      args: { name: "3gpp-review" },
      request: "帮助我下载 KI #18 最近一次会议的 Huawei 提案",
      agent: {
        id: 1,
        tools: [
          "bash",
          "python",
          "filesystem.read",
          "filesystem.write",
          "filesystem.list",
          "filesystem.search",
          "web.fetch",
          "vision.inspect",
          "knowledge.publish",
        ],
      },
      skills: [
        {
          name: "3gpp-review",
          allowedTools:
            "skill.activate skill.read_resource bash python filesystem.read filesystem.write filesystem.list filesystem.search web.fetch vision.inspect knowledge.publish",
        },
      ],
    });

    expect(plan.tasks).toHaveLength(4);
    expect(plan.tasks[0].allowedToolIds).toEqual([
      "skill.activate",
      "skill.read_resource",
    ]);
    expect(plan.tasks[1].dependsOn).toEqual(["activate-3gpp-review"]);
    expect(plan.tasks[2].dependsOn).toEqual(["resolve-and-filter"]);
    expect(plan.tasks[3].dependsOn).toEqual(["download-extract-cover"]);
    expect(plan.tasks[3].allowedToolIds).toContain("knowledge.publish");
    expect(
      plan.tasks
        .slice(0, 3)
        .every((task) =>
          task.allowedToolIds.every((toolId) => toolId !== "knowledge.publish")
        )
    ).toBe(true);
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

    const selectedTools = plan.tasks.flatMap((task) => task.allowedToolIds);
    expect(selectedTools).toContain("web.fetch");
    expect(selectedTools).not.toContain("bash");
    expect(selectedTools).not.toContain("python");
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
    expect(requestAllowsWrite("请帮我下载提案并生成报告")).toBe(true);
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
