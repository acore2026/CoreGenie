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

  it("uses completed records when a worker incorrectly says every call failed", () => {
    const grounded = groundWorkerResultInToolExecutions(
      {
        summary: "三次工具调用均因预算耗尽而失败，未返回任何官方数据。",
        evidence: [],
        unresolved: [],
      },
      { id: "task-2" },
      [],
      [
        {
          tool_id: "3gpp.resolve-meeting",
          status: "completed",
          result: { ok: true, summary: "找到 SA2#175 官方目录。" },
        },
      ]
    );

    expect(grounded.summary).toContain("已成功执行 3gpp.resolve-meeting");
    expect(grounded.evidence).toEqual([
      expect.objectContaining({ excerpt: "找到 SA2#175 官方目录。" }),
    ]);
  });

  it("replaces a false empty-search summary with the actual results", () => {
    const grounded = groundWorkerResultInToolExecutions(
      {
        summary: "没有成功检索到报告全文，也没有返回相关资料。",
        evidence: [],
        unresolved: ["未读取到任何文档。"],
      },
      { id: "task-3" },
      ["rag.search", "filesystem.read"],
      [
        {
          tool_id: "rag.search",
          status: "completed",
          result: { ok: true, data: [{ text: "报告内容" }] },
        },
        {
          tool_id: "filesystem.read",
          status: "completed",
          result: { ok: true, summary: "已读取报告全文。", data: "正文" },
        },
      ]
    );

    expect(grounded.summary).toContain(
      "已成功执行 rag.search, filesystem.read"
    );
    expect(grounded.unresolved).toEqual([]);
  });
});
