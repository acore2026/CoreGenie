/* eslint-env jest, node */
const {
  DEFAULTS,
  activateSkillControlTool,
  activatedSkillToolIds,
  askUserTool,
  controllerDecisionWithFallback,
  controllerDirectActionsEnabled,
  classify3gppRequest,
  createGovernedGraph,
  delegatedControllerActionPlan,
  effectiveTaskToolIds,
  groundWorkerResultInToolExecutions,
  isKnowledgeIngestionRequest,
  is3gppMarkdownConversionAgent,
  isQuick3gppLookupTask,
  knowledgeToolGuidance,
  mergeById,
  normalizeReviewDecision,
  normalizeControllerAction,
  normalized3gppLookupPlan,
  normalizedActionPlan,
  parse3gppInvitationFacts,
  parse3gppConversionRequest,
  parse3gppMeetingRequest,
  planValidationRetry,
  priorToolResultsContext,
  quick3gppResponse,
  rethrowWorkerInterrupt,
  requestAllowsWrite,
  resolvedTaskDependencies,
  scopedTaskId,
  shouldRecallPersonalMemory,
  shouldRetryNoProgressTask,
  shouldRetrieveWorkspaceContext,
  streamControllerDecision,
  taskHasWriteTool,
  taskRequestsArtifactWrite,
  taskRequiredCompletionTools,
  validatePlan,
  workerContinuationInstruction,
  workerResultFromPlainText,
  workerSystemPrompt,
} = require("../../agent-system/runtimes/governed");
const {
  Annotation,
  Command,
  END,
  GraphInterrupt,
  MemorySaver,
  START,
  StateGraph,
  interrupt: pauseGraph,
} = require("@langchain/langgraph");
const {
  normalizeToolId,
  taskSelectionAllows,
  toolRegistry,
} = require("../../tools");

const context = {
  run: { id: "run-1", prompt: "Research the latest meeting agenda" },
  agent: { id: 1 },
  availableAgents: [{ id: 2 }],
};

describe("Governed Agent runtime", () => {
  it("bounds long tasks before they can run unattended for hours", () => {
    expect(DEFAULTS.maxTasks).toBe(8);
    expect(DEFAULTS.maxReviewRounds).toBe(1);
    expect(DEFAULTS.maxTaskToolCalls).toBe(40);
    expect(DEFAULTS.maxTaskModelCalls).toBe(16);
    expect(DEFAULTS.maxTaskMs).toBe(8 * 60 * 1_000);
    expect(DEFAULTS.maxRunMs).toBe(15 * 60 * 1_000);
    expect(DEFAULTS.maxConsecutiveNoProgress).toBe(3);
    expect(DEFAULTS.maxQuickLookupToolCalls).toBe(12);
    expect(DEFAULTS.maxQuickLookupModelCalls).toBe(8);
  });

  it("keeps direct controller actions disabled unless explicitly enabled", () => {
    expect(controllerDirectActionsEnabled({})).toBe(false);
    expect(
      controllerDirectActionsEnabled({
        ENABLE_CONTROLLER_DIRECT_ACTIONS: "false",
      })
    ).toBe(false);
    expect(
      controllerDirectActionsEnabled({
        ENABLE_CONTROLLER_DIRECT_ACTIONS: "true",
      })
    ).toBe(true);
  });

  it("accepts a gap-free partial review when every task completed", () => {
    expect(
      normalizeReviewDecision(
        { status: "partial", gaps: [], replacementTasks: [] },
        [
          { status: "completed", unresolved: [] },
          { status: "completed", unresolved: [] },
        ]
      )
    ).toEqual({ status: "accept", gaps: [], replacementTasks: [] });
  });

  it("preserves partial review status when a real gap remains", () => {
    expect(
      normalizeReviewDecision(
        {
          status: "partial",
          gaps: ["One output could not be verified."],
          replacementTasks: [],
        },
        [{ status: "completed", unresolved: [] }]
      ).status
    ).toBe("partial");
  });

  it("recognizes document splitting and exported output as write requests", () => {
    expect(
      requestAllowsWrite(
        "请按三级标题拆分上传的TR文件，拆分后输出到源文件同目录的同名文件夹中。"
      )
    ).toBe(true);
    expect(requestAllowsWrite("Export the converted document")).toBe(true);
  });

  it("retries a no-progress task once when earlier tool calls produced results", () => {
    const executions = [
      {
        status: "completed",
        result: { ok: true, code: "OK", data: "Missing count: 44" },
      },
    ];

    expect(
      shouldRetryNoProgressTask({
        error: { code: "TASK_NO_PROGRESS" },
        attempt: 1,
        maxAttempts: 2,
        executions,
      })
    ).toBe(true);
    expect(
      shouldRetryNoProgressTask({
        error: { code: "TASK_NO_PROGRESS" },
        attempt: 2,
        maxAttempts: 2,
        executions,
      })
    ).toBe(false);
    expect(
      shouldRetryNoProgressTask({
        error: { code: "TASK_TIME_BUDGET_EXHAUSTED" },
        attempt: 1,
        maxAttempts: 2,
        executions,
      })
    ).toBe(false);
  });

  it("passes successful tool output to the recovery worker without duplicates", () => {
    const executions = [
      {
        id: "one",
        operation_key: "same-command",
        tool_id: "bash",
        status: "completed",
        result: { ok: true, code: "OK", data: "Missing count: 44" },
      },
      {
        id: "two",
        operation_key: "same-command",
        tool_id: "bash",
        status: "completed",
        result: { ok: true, code: "OK", data: "Missing count: 44" },
      },
    ];

    const context = priorToolResultsContext(executions);

    expect(context).toContain("Missing count: 44");
    expect(context).toContain("do not run the same command again");
    expect(context.match(/Missing count: 44/g)).toHaveLength(1);
  });

  it("does not preload workspace RAG for a public-web-only request", () => {
    expect(
      shouldRetrieveWorkspaceContext("尝试在线搜索 Agent Connecting Network", {
        autoRecall: true,
        mode: "chat",
      })
    ).toBe(false);
    expect(
      shouldRetrieveWorkspaceContext("Search the web for current ACN news", {
        autoRecall: true,
        mode: "chat",
      })
    ).toBe(false);
  });

  it("keeps workspace retrieval when the request names workspace sources", () => {
    expect(
      shouldRetrieveWorkspaceContext("同时搜索工作区和互联网中的 ACN 资料", {
        autoRecall: true,
        mode: "chat",
      })
    ).toBe(true);
    expect(
      shouldRetrieveWorkspaceContext("在知识库中检索 ACN", {
        autoRecall: true,
        mode: "chat",
      })
    ).toBe(true);
  });

  it("does not preload RAG or personal-memory context for document ingestion intent", () => {
    expect(isKnowledgeIngestionRequest("将这些文档加入 RAG")).toBe(true);
    expect(isKnowledgeIngestionRequest("记住我喜欢简短报告")).toBe(false);
    expect(
      shouldRetrieveWorkspaceContext("将这些文档加入 RAG", {
        autoRecall: true,
        mode: "automatic",
      })
    ).toBe(false);
    expect(
      shouldRecallPersonalMemory("将这些文档加入 RAG", {
        autoRecall: true,
        userId: 1,
      })
    ).toBe(false);
    expect(requestAllowsWrite("将这些文档加入 RAG")).toBe(true);
  });

  it("describes only knowledge tools visible to the controller model", () => {
    const guidance = knowledgeToolGuidance(new Set(["knowledge.search"]));

    expect(guidance).toContain("knowledge.search");
    expect(guidance).not.toContain("knowledge.ingest");
    expect(guidance).not.toContain("knowledge.publish");
    expect(guidance).not.toContain("memory.store");
  });

  it("routes only simple 3GPP meeting facts to the quick lookup", () => {
    expect(classify3gppRequest("SA2#175 是什么时候的会议？")).toBe(
      "3gpp_fact_lookup"
    );
    expect(classify3gppRequest("SA2#175 在哪里举行？")).toBe(
      "3gpp_fact_lookup"
    );
    expect(classify3gppRequest("下载 SA2#175 KI#22 中 Huawei 的提案")).toBe(
      "general"
    );
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
      allowedToolIds: ["3gpp.resolve-meeting", "web.fetch"],
    });
    expect(plan.tasks[0].allowedToolIds).not.toEqual(
      expect.arrayContaining(["bash", "python", "filesystem.write"])
    );
    expect(isQuick3gppLookupTask(plan.tasks[0])).toBe(true);
  });

  it("does not apply quick lookup limits to a full 3GPP review task", () => {
    expect(
      isQuick3gppLookupTask({
        title: "解析会议目录并下载文稿",
        writeIntent: true,
        allowedToolIds: [
          "3gpp.resolve-meeting",
          "web.fetch",
          "filesystem.write",
        ],
      })
    ).toBe(false);
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

  it("keeps report-writing instructions out of a read-only worker", () => {
    const taskItem = {
      title: "比较公司立场",
      objective: "完成 ledger 和 coverage 检查",
      successCriteria: ["返回比较结果"],
      writeIntent: false,
    };
    const prompt = workerSystemPrompt({
      basePrompt: "Base prompt",
      taskItem,
      allowedToolIds: ["filesystem.read"],
      requiredToolIds: [],
      dependencyResults: [],
    });
    const continuation = workerContinuationInstruction({
      reasons: ["More analysis is required."],
      missingToolIds: ["filesystem.read"],
      completedToolIds: [],
      writeEnabled: false,
    });

    expect(prompt).toMatch(/read-only task/i);
    expect(prompt).toMatch(/Do not create, update, save, or publish/);
    expect(prompt).not.toMatch(
      /create the file with a first filesystem\.write/
    );
    expect(continuation).toMatch(/read-only task/i);
    expect(continuation).not.toMatch(/filesystem\.write chunks/);
  });

  it("keeps requested list fields in the worker handoff", () => {
    const prompt = workerSystemPrompt({
      basePrompt: "Base prompt",
      userRequest: "列出每个 TDoc 的编号、标题、Source 和状态。",
      taskItem: {
        title: "筛选提案",
        objective: "生成并检查提案清单",
        successCriteria: ["清单已验证"],
        writeIntent: true,
      },
      allowedToolIds: ["bash"],
      requiredToolIds: [],
      dependencyResults: [],
    });

    expect(prompt).toContain(
      "Original user request: 列出每个 TDoc 的编号、标题、Source 和状态。"
    );
    expect(prompt).toMatch(/include every requested row and field/i);
    expect(prompt).toMatch(/count or file path alone is not sufficient/i);
    expect(prompt).toMatch(/state it once outside the table/i);
    expect(prompt).toMatch(/Never omit a requested row or field/i);
  });

  it("validates artifact-writing requirements against task tools", () => {
    const readOnlyTask = {
      title: "跨会议比较",
      objective: "完成 ledger",
      successCriteria: ["ledger 已完成"],
    };

    expect(taskRequestsArtifactWrite(readOnlyTask)).toBe(true);
    expect(taskHasWriteTool(["filesystem.read"])).toBe(false);
    expect(taskHasWriteTool(["filesystem.write"])).toBe(true);
    expect(() =>
      validatePlan(
        {
          goal: "比较路线",
          tasks: [
            {
              id: "compare",
              ...readOnlyTask,
              allowedToolIds: ["filesystem.read"],
              writeIntent: false,
            },
          ],
        },
        {
          ...context,
          run: { id: "run-1", prompt: "比较路线并生成 ledger" },
          agent: {
            id: 1,
            tools: ["filesystem.read", "filesystem.write"],
          },
        }
      )
    ).toThrow(/requires an artifact write/);
  });

  it("recognizes downloaded and extracted 3GPP files as artifact writes", () => {
    expect(
      taskRequestsArtifactWrite({
        title: "下载并提取 Word 原文",
        objective: "下载 KI #18 TDoc ZIP，解压并保存 DOCX 原文",
        successCriteria: ["TDoc 原文可从工作区下载"],
      })
    ).toBe(true);
    expect(
      taskRequestsArtifactWrite({
        title: "下载会议 Index",
        objective: "下载 SA2 会议 Index XLSX 文件并生成 proposals.json 清单",
      })
    ).toBe(true);
    expect(
      taskRequestsArtifactWrite({
        title: "比较提案",
        objective: "分析并比较三个 TDoc 的技术路线",
        successCriteria: ["返回比较结果"],
      })
    ).toBe(false);
  });

  it("does not confuse reading converted files and extracting fields with an artifact write", () => {
    const task = {
      id: "analyze",
      title: "逐篇分析三个 TDoc 的注册路径提案",
      objective:
        "阅读三个转换后的 Markdown 文件，逐篇提取：TDoc 编号、标题、提案方、状态、目标 KI、注册路径架构、新增/变更网络功能与接口、流程步骤与信令图。使用 vision.inspect 核验关键流程图。将完整分析结果写入 worker JSON 返回。",
      allowedToolIds: [
        "filesystem.read",
        "vision.inspect",
        "knowledge.search",
      ],
      successCriteria: [
        "每个 TDoc 均有完整分析，包含注册路径、网络功能、流程步骤",
        "关键流程图已视觉核验或标注不确定",
      ],
      writeIntent: false,
    };

    expect(taskRequestsArtifactWrite(task)).toBe(false);
    expect(() =>
      validatePlan(
        { goal: "比较三个 KI #18 TDoc", tasks: [task] },
        {
          ...context,
          run: { id: "run-1", prompt: "比较三个 KI #18 TDoc 并生成报告" },
          agent: {
            id: 1,
            tools: [
              "filesystem.read",
              "vision.inspect",
              "knowledge.search",
            ],
          },
        }
      )
    ).not.toThrow();
  });

  it("returns malformed plans to the controller once with validation feedback", () => {
    const error = new Error("Task task-2 has an unknown dependency.");

    expect(planValidationRetry(error, 0)).toEqual({
      control: { kind: "retry_planning" },
      planningFeedback: "Task task-2 has an unknown dependency.",
      planningAttempts: 1,
    });
    expect(planValidationRetry(error, 1)).toBeNull();
  });

  it("promotes artifact-producing tasks when a write-capable tool is present", () => {
    const plan = validatePlan(
      {
        goal: "拆分并验证文档",
        tasks: [
          {
            id: "validate-output",
            title: "验证输出质量",
            objective: "统计结果并生成文件清单和质量报告",
            allowedToolIds: ["python", "filesystem-list"],
            successCriteria: ["质量报告已生成"],
            writeIntent: false,
          },
        ],
      },
      {
        ...context,
        run: { id: "run-1", prompt: "拆分文档并生成质量报告" },
        agent: { id: 1, tools: null },
      }
    );

    expect(plan.tasks[0]).toMatchObject({
      allowedToolIds: ["python", "filesystem.list"],
      writeIntent: true,
    });
  });

  it("accepts a plain worker summary after all required tools succeeded", () => {
    expect(
      workerResultFromPlainText(
        { messages: [{ role: "assistant", content: "ZIP 已生成并检查。" }] },
        []
      )
    ).toEqual({
      summary: "ZIP 已生成并检查。",
      evidence: [],
      unresolved: [],
    });
    expect(
      workerResultFromPlainText(
        { messages: [{ role: "assistant", content: "ZIP 已生成。" }] },
        ["3gpp.convert-markdown"]
      )
    ).toBeNull();
  });

  it("routes one TDoc or one uploaded DOCX into the fixed conversion flow", () => {
    expect(
      parse3gppConversionRequest("请下载 S2-2606085，并转换成 Markdown。")
    ).toEqual({ tdoc: "S2-2606085" });
    expect(
      parse3gppConversionRequest("请转换这个文件。", [
        {
          mime: "application/anythingllm-workspace-file",
          contentString: "/workspace/uploads/upload-1/proposal.docx",
        },
      ])
    ).toEqual({
      input_path: "/workspace/uploads/upload-1/proposal.docx",
    });
    expect(
      is3gppMarkdownConversionAgent({
        runtimeConfig: { workflow: "3gpp-markdown-conversion" },
      })
    ).toBe(true);
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

  it("requires a controller-normalized action to execute its selected tool", () => {
    const descriptor = toolRegistry.get(normalizeToolId("rag.search"));
    const normalized = normalizeControllerAction(
      {
        name: "knowledge.search",
        args: { query: "Agent Connecting Network ACN" },
      },
      [descriptor],
      "尝试在线搜索"
    );
    const plan = normalized.plan;

    expect(normalized.descriptor).toBe(descriptor);
    expect(plan.tasks[0].allowedToolIds).toEqual(["knowledge.search"]);

    expect(
      taskRequiredCompletionTools(
        { runtimeSnapshot: { runtimeConfig: {} } },
        plan.tasks[0].allowedToolIds,
        plan.tasks[0]
      )
    ).toEqual(["knowledge.search"]);
  });

  it("scopes normalized read actions to the selected tool", () => {
    const descriptor = toolRegistry.get("knowledge.search");
    const plan = normalizedActionPlan({
      descriptor,
      args: { query: "SA2 Key Issues KI list" },
      request: "SA2 会议有哪些 KI",
    });

    expect(plan.tasks[0]).toMatchObject({
      allowedToolIds: ["knowledge.search"],
      writeIntent: false,
    });
    expect(
      taskRequiredCompletionTools(
        { runtimeSnapshot: { runtimeConfig: {} } },
        plan.tasks[0].allowedToolIds,
        plan.tasks[0]
      )
    ).toEqual(["knowledge.search"]);
  });

  it("delegates a repeated direct controller action as a writable worker plan", () => {
    const descriptor = toolRegistry.get("filesystem.search");
    const plan = delegatedControllerActionPlan({
      call: {
        name: "filesystem.search",
        args: { path: "/workspace", pattern: "**/*23801*.docx" },
      },
      descriptor,
      descriptors: [
        descriptor,
        toolRegistry.get("filesystem.read"),
        toolRegistry.get("filesystem.write"),
        toolRegistry.get("python"),
        toolRegistry.get("memory.delete"),
        toolRegistry.get("knowledge.publish"),
      ],
      request:
        "请按三级标题拆分上传的TR文件，拆分后输出到源文件同目录的同名文件夹中。",
      hasAvailableAgents: true,
    });

    expect(plan.tasks[0]).toMatchObject({
      id: "complete-request-with-inherited-tools",
      writeIntent: true,
      allowedToolIds: [
        "filesystem.search",
        "filesystem.read",
        "filesystem.write",
        "python",
        "agent.call",
      ],
    });
    expect(plan.tasks[0].allowedToolIds).not.toContain("memory.delete");
    expect(plan.tasks[0].allowedToolIds).not.toContain("knowledge.publish");
    expect(plan.tasks[0].objective).toContain(
      "这只是一条定位线索，不是任务的完成条件"
    );
  });

  it("keeps a delegated read request read-only", () => {
    const descriptor = toolRegistry.get("filesystem.search");
    const plan = delegatedControllerActionPlan({
      call: { name: "filesystem.search", args: { pattern: "**/*.md" } },
      descriptor,
      descriptors: [
        descriptor,
        toolRegistry.get("filesystem.write"),
        toolRegistry.get("python"),
      ],
      request: "有哪些 Markdown 文件？",
    });

    expect(plan.tasks[0].writeIntent).toBe(false);
    expect(plan.tasks[0].allowedToolIds).toEqual(["filesystem.search"]);
  });

  it("does not add agent.call when the selected Agent policy disallows it", () => {
    const descriptor = toolRegistry.get("filesystem.search");
    const plan = delegatedControllerActionPlan({
      call: { name: "filesystem.search", args: { path: "/workspace" } },
      descriptor,
      descriptors: [descriptor, toolRegistry.get("filesystem.read")],
      request: "比较三个已上传的 TDoc。",
      hasAvailableAgents: true,
      agentTools: ["filesystem.search", "filesystem.read"],
    });

    expect(plan.tasks[0].allowedToolIds).toEqual([
      "filesystem.search",
      "filesystem.read",
    ]);
    expect(plan.tasks[0].allowedToolIds).not.toContain("agent.call");
  });

  it("does not normalize a controller action outside its visible tools", () => {
    expect(
      normalizeControllerAction(
        { name: "knowledge.search", args: { query: "KI#18" } },
        [],
        "搜索 KI#18"
      )
    ).toBeNull();
  });

  it("grounds a worker result in the durable search execution", () => {
    const grounded = groundWorkerResultInToolExecutions(
      {
        summary:
          "No knowledge_search tool call was executed, so no search results were captured.",
        evidence: [],
        unresolved: ["The search tool was not executed."],
      },
      { id: "task-1" },
      ["knowledge.search"],
      [
        {
          tool_id: "knowledge.search",
          status: "completed",
          arguments: { query: "Agent Connecting Network ACN" },
          result: {
            ok: true,
            data: [
              {
                text: "ACN is discussed in this workspace document.",
                source: {
                  title: "ACN proposal",
                  url: "workspace://acn.md",
                },
              },
            ],
          },
        },
      ]
    );

    expect(grounded.summary).toMatch(/已成功执行 knowledge\.search/);
    expect(grounded.unresolved).toEqual([]);
    expect(grounded.evidence).toEqual([
      expect.objectContaining({
        kind: "rag",
        title: "ACN proposal",
        uri: "workspace://acn.md",
      }),
    ]);
  });

  it("grounds a contradictory worker result even without required completion tools", () => {
    const grounded = groundWorkerResultInToolExecutions(
      {
        summary: "没有执行任何工具调用。",
        evidence: [],
        unresolved: ["Skill 未执行。"],
      },
      { id: "task-1" },
      [],
      [
        {
          tool_id: "skill.activate",
          status: "completed",
          arguments: { name: "3gpp-review" },
          result: {
            ok: true,
            summary: "Activated 3gpp-review.",
          },
        },
      ]
    );

    expect(grounded.summary).toMatch(/已成功执行 skill\.activate/);
    expect(grounded.unresolved).toEqual([]);
    expect(grounded.evidence).toEqual([
      expect.objectContaining({
        kind: "tool",
        title: "skill.activate 结果",
        excerpt: "Activated 3gpp-review.",
      }),
    ]);
  });

  it("offers exact Skill names as pre-planning controller actions", () => {
    const control = activateSkillControlTool([
      { name: "3gpp-review" },
      { name: "3gpp-lookup" },
    ]);

    expect(control.name).toBe("activate_skill");
    expect(control.description).toMatch(/before planning/);
    expect(control.schema.safeParse({ name: "3gpp-review" }).success).toBe(
      true
    );
    expect(control.schema.safeParse({ name: "unknown" }).success).toBe(false);
  });

  it("compiles without state-channel and node-name collisions", async () => {
    await expect(
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
    ).resolves.toBeDefined();
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

  it("accepts RAG document ingestion and rejects personal-memory storage for the same Agent", () => {
    const ingestionContext = {
      ...context,
      run: { id: "run-ingest", prompt: "将这些文档加入 RAG" },
      agent: { id: 7, tools: ["knowledge.ingest", "knowledge.search"] },
    };
    const plan = validatePlan(
      {
        goal: "将文档加入 Workspace RAG",
        tasks: [
          {
            id: "ingest",
            title: "加入 RAG",
            objective: "将已解析文档加入 Workspace RAG 知识库",
            allowedToolIds: ["knowledge.ingest"],
            writeIntent: true,
          },
        ],
      },
      ingestionContext
    );

    expect(plan.tasks[0]).toMatchObject({
      allowedToolIds: ["knowledge.ingest"],
      writeIntent: true,
    });
    expect(() =>
      validatePlan(
        {
          goal: "错误地保存到个人记忆",
          tasks: [
            {
              id: "store-memory",
              title: "错误入库",
              objective: "保存文档",
              allowedToolIds: ["memory.store"],
              writeIntent: true,
            },
          ],
        },
        ingestionContext
      )
    ).toThrow(/disallowed tool memory\.store/);
  });

  it("rejects Skill activation inside a task plan", () => {
    expect(() =>
      validatePlan(
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
      )
    ).toThrow(/before create_plan/);
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

  it("never normalizes Skill activation into a work plan", () => {
    expect(() =>
      normalizedActionPlan({
        descriptor: toolRegistry.get("skill.activate"),
        args: { name: "3gpp-review" },
        request: "下载 KI #18 文稿",
      })
    ).toThrow(/pre-planning controller action/);
  });

  it("ignores activated Skill tool declarations by default", () => {
    const skills = [
      {
        name: "3gpp-review",
        allowedTools: "skill.read_resource bash web.fetch",
      },
    ];
    expect(activatedSkillToolIds(skills)).toBeNull();
    expect(
      effectiveTaskToolIds(
        [
          "skill.activate",
          "skill.read_resource",
          "bash",
          "python",
          "web.fetch",
        ],
        { tools: ["bash", "python", "web-browsing"] },
        skills
      )
    ).toEqual(["skill.read_resource", "bash", "python", "web.fetch"]);
  });

  it("intersects task tools with Skill declarations when configured", () => {
    const skills = [
      {
        name: "3gpp-review",
        allowedTools: "skill.read_resource bash web.fetch",
      },
    ];
    expect(activatedSkillToolIds(skills, true)).toEqual(
      new Set(["skill.read_resource", "bash", "web.fetch"])
    );
    expect(
      effectiveTaskToolIds(
        [
          "skill.activate",
          "skill.read_resource",
          "bash",
          "python",
          "web.fetch",
        ],
        { tools: ["bash", "python", "web-browsing"] },
        skills,
        true
      )
    ).toEqual(["skill.read_resource", "bash", "web.fetch"]);
  });

  it("does not let a skill expand beyond the selected Agent tool policy", () => {
    expect(
      effectiveTaskToolIds(
        ["bash", "python", "web.fetch"],
        { id: 1, tools: ["web-browsing"] },
        [{ name: "3gpp-review", allowedTools: "bash python web.fetch" }],
        true
      )
    ).toEqual(["web.fetch"]);
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

  it("does not turn a worker input request into a failed task", () => {
    const interrupt = new GraphInterrupt([
      {
        value: {
          kind: "input",
          requestId: "worker-input-1",
          questions: [{ kind: "choice", question: "选择会议范围" }],
        },
      },
    ]);

    expect(() => rethrowWorkerInterrupt(interrupt)).toThrow(interrupt);
    expect(() =>
      rethrowWorkerInterrupt(new Error("ordinary failure"))
    ).not.toThrow();
  });

  it("pauses and resumes an input request raised by a nested worker graph", async () => {
    const checkpointer = new MemorySaver();
    const innerState = Annotation.Root({ answer: Annotation() });
    const workerGraph = new StateGraph(innerState)
      .addNode("ask", () => ({
        answer: pauseGraph({
          kind: "input",
          requestId: "worker-input-1",
          questions: [{ kind: "choice", question: "选择会议范围" }],
        }),
      }))
      .addEdge(START, "ask")
      .addEdge("ask", END)
      .compile({ checkpointer });
    const outerState = Annotation.Root({ answer: Annotation() });
    const graph = new StateGraph(outerState)
      .addNode("worker", async (_state, config) => {
        try {
          return await workerGraph.invoke(
            {},
            {
              ...config,
              configurable: {
                ...config.configurable,
                thread_id: "nested-worker-input",
              },
            }
          );
        } catch (error) {
          rethrowWorkerInterrupt(error);
          throw error;
        }
      })
      .addEdge(START, "worker")
      .addEdge("worker", END)
      .compile({ checkpointer });
    const config = { configurable: { thread_id: "outer-worker-input" } };

    const paused = await graph.invoke({}, config);
    expect(paused.__interrupt__[0].value).toMatchObject({
      kind: "input",
      requestId: "worker-input-1",
    });

    const answer = {
      skipped: false,
      answers: [{ skipped: false, answer: "SA2#175 至 #176" }],
    };
    await expect(
      graph.invoke(new Command({ resume: answer }), config)
    ).resolves.toMatchObject({ answer });
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
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith("download complete");
  });

  it("does not stream controller preamble text before a control call", async () => {
    const controlCall = {
      name: "create_plan",
      args: { goal: "download", tasks: [] },
    };
    async function* chunks() {
      yield {
        content: "让我先制定",
        tool_calls: [],
        concat: () => ({
          content: "让我先制定",
          tool_calls: [controlCall],
        }),
      };
      yield { content: "", tool_calls: [controlCall] };
    }
    const onToken = jest.fn();
    const decision = await streamControllerDecision(
      { stream: jest.fn().mockResolvedValue(chunks()) },
      [{ role: "user", content: "download" }],
      { onToken, streamOptions: {} }
    );

    expect(decision.calls).toEqual([controlCall]);
    expect(decision.streamedDirect).toBe(false);
    expect(onToken).not.toHaveBeenCalled();
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
