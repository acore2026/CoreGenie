/* eslint-env jest, node */
const {
  groundWorkerResultInToolExecutions,
} = require("../../agent-system/runtimes/governed");

describe("governed worker durable result grounding", () => {
  it("corrects a false no-execution summary without required completion tools", () => {
    const grounded = groundWorkerResultInToolExecutions(
      {
        summary:
          "无法完成提取，因为 Skill 未实际激活，也没有执行任何工具调用。",
        evidence: [],
        unresolved: ["Skill 未执行。"],
      },
      { id: "extract-tdocs" },
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
        {
          tool_id: "bash",
          status: "completed",
          arguments: { code: "python3 scripts/3gpp_tdocs.py extract" },
          result: {
            ok: true,
            summary: "Expected: 89; Extracted: 89; Missing: none.",
          },
        },
      ]
    );

    expect(grounded.summary).toMatch(/已成功执行/);
    expect(grounded.summary).toContain("skill.activate");
    expect(grounded.summary).toContain("bash");
    expect(grounded.unresolved).toEqual([]);
    expect(grounded.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "skill.activate 结果" }),
        expect.objectContaining({ title: "bash 结果" }),
      ])
    );
  });
});
