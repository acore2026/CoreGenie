/* eslint-env jest, node */
const { normalizeUserQuestions } = require("../../tools/userInput");

describe("User input tool", () => {
  it("converts worker questions into the client survey format", () => {
    expect(
      normalizeUserQuestions([
        { question: "补充说明", type: "text" },
        {
          question: "选择会议范围",
          type: "single",
          options: ["SA2#175", "SA2#175 至 #176"],
        },
        {
          question: "选择公司",
          type: "multiple",
          options: ["Huawei", "Ericsson"],
        },
      ])
    ).toEqual([
      {
        kind: "input",
        question: "补充说明",
        options: [],
        multiSelect: false,
        allowOther: true,
      },
      {
        kind: "choice",
        question: "选择会议范围",
        options: ["SA2#175", "SA2#175 至 #176"],
        multiSelect: false,
        allowOther: true,
      },
      {
        kind: "choice",
        question: "选择公司",
        options: ["Huawei", "Ericsson"],
        multiSelect: true,
        allowOther: true,
      },
    ]);
  });
});
