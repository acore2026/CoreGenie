/* eslint-env jest, node */
const {
  groundWorkerResultInToolExecutions,
} = require("../../agent-system/runtimes/governed");

describe("worker result grounding", () => {
  it("corrects a Chinese claim that a successfully completed tool was not called", () => {
    const grounded = groundWorkerResultInToolExecutions(
      {
        summary: "在本次会话中，rag_search 工具实际未被调用。",
        evidence: [],
        unresolved: ["工具调用步骤被跳过。"],
      },
      { id: "task-1" },
      ["rag.search"],
      [
        {
          tool_id: "rag.search",
          status: "completed",
          arguments: { query: "KI #18" },
          result: { ok: true, summary: "找到相关资料。" },
        },
      ]
    );

    expect(grounded.summary).toContain("已成功执行 rag.search");
    expect(grounded.unresolved).toEqual([]);
  });
});
