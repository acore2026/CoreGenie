/* eslint-env jest, node */
const {
  cleanExamplePrompts,
} = require("../../endpoints/predefinedAgents");

describe("predefined Agent example prompts", () => {
  it("keeps a short label and a detailed prompt as separate values", () => {
    expect(
      cleanExamplePrompts([
        {
          label: "比较两家公司在指定 KI 上的路线",
          prompt: "聚焦 KI #18，按会议比较 Huawei 与 Ericsson 的提案。",
        },
      ])
    ).toEqual([
      {
        label: "比较两家公司在指定 KI 上的路线",
        prompt: "聚焦 KI #18，按会议比较 Huawei 与 Ericsson 的提案。",
      },
    ]);
  });

  it("continues to accept existing string prompts", () => {
    expect(cleanExamplePrompts(["分析指定提案"])).toEqual(["分析指定提案"]);
  });
});
