/* eslint-env jest, node */
const {
  DEFAULTS,
  blockedTaskResults,
  recoverTerminalWorkerResult,
  taskCanDispatch,
  validatePlan,
} = require("../../agent-system/runtimes/governed");

describe("governed execution bounds", () => {
  it("keeps ordinary Agent runs within practical limits", () => {
    expect(DEFAULTS.maxTasks).toBe(8);
    expect(DEFAULTS.maxReviewRounds).toBe(1);
    expect(DEFAULTS.maxTaskToolCalls).toBe(40);
    expect(DEFAULTS.maxTaskModelCalls).toBe(16);
    expect(DEFAULTS.maxTaskMs).toBe(8 * 60 * 1_000);
    expect(DEFAULTS.maxRunMs).toBe(15 * 60 * 1_000);
    expect(DEFAULTS.maxConsecutiveNoProgress).toBe(3);
  });

  it("cascades skipped dependencies without dispatching their children", () => {
    const tasks = [
      {
        id: "verify",
        dependsOn: ["bootstrap"],
        acceptsPartialDependencies: false,
      },
      {
        id: "write",
        dependsOn: ["verify"],
        acceptsPartialDependencies: false,
      },
    ];
    const failed = { id: "bootstrap", status: "failed", error: "启动失败" };
    const skipped = blockedTaskResults(tasks, [failed]);
    const results = new Map(
      [failed, ...skipped].map((item) => [item.id, item])
    );

    expect(skipped.map((item) => item.id)).toEqual(["verify", "write"]);
    expect(taskCanDispatch(tasks[1], results)).toBe(false);
  });

  it("adds the publish tool when the requested publish step omitted it", () => {
    const plan = validatePlan(
      {
        goal: "生成并发布报告",
        tasks: [
          {
            id: "publish",
            title: "发布报告到知识库",
            objective: "将 verified 版报告发布到 Workspace 知识库。",
            dependsOn: [],
            allowedToolIds: ["filesystem.read"],
            requiredCapabilities: [],
            successCriteria: ["报告已发布到知识库"],
            acceptsPartialDependencies: false,
            writeIntent: true,
          },
        ],
      },
      {
        run: { id: "run-1", prompt: "生成报告并发布到知识库" },
        agent: {
          id: 7,
          tools: ["filesystem.read", "knowledge.publish"],
        },
      }
    );

    expect(plan.tasks[0].allowedToolIds).toEqual([
      "filesystem.read",
      "knowledge.publish",
    ]);
    expect(plan.tasks[0].writeIntent).toBe(true);
  });

  it("keeps successful tool results when result formatting makes no progress", () => {
    const error = new Error("任务连续 3 次没有获得新结果，已停止当前步骤。");
    error.code = "TASK_NO_PROGRESS";
    const result = recoverTerminalWorkerResult({
      taskItem: { id: "scope" },
      executions: [
        {
          tool_id: "rag.search",
          status: "completed",
          arguments: { query: "KI#18" },
          result: { ok: true, data: [{ text: "已有报告" }] },
        },
        {
          tool_id: "web.search",
          status: "completed",
          result: { ok: true, summary: "找到官方会议目录。" },
        },
      ],
      error,
    });

    expect(result.summary).toContain("已成功执行 rag.search, web.search");
    expect(result.evidence).toHaveLength(2);
    expect(result.unresolved).toHaveLength(1);
  });

  it("does not recover an output task before its required publish succeeds", () => {
    const error = new Error("任务运行超时。");
    error.code = "TASK_TIME_BUDGET_EXHAUSTED";
    const result = recoverTerminalWorkerResult({
      taskItem: { id: "publish" },
      requiredToolIds: ["knowledge.publish"],
      executions: [
        {
          tool_id: "filesystem.write",
          status: "completed",
          result: { ok: true, summary: "报告已写入。" },
        },
      ],
      error,
    });

    expect(result).toBeNull();
  });
});
