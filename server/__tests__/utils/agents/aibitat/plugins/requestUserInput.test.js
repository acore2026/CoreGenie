/* eslint-env jest, node */
const {
  normalizeQuestion,
} = require("../../../../../utils/agents/aibitat/plugins/request-user-input");

describe("request-user-input choice questions", () => {
  it("accepts exactly three provided choices and always enables custom notes", () => {
    expect(
      normalizeQuestion({
        kind: "choice",
        question: "Which scope should I use?",
        options: ["Latest only", "All versions", "Baseline only"],
        allowOther: false,
      })
    ).toMatchObject({
      options: ["Latest only", "All versions", "Baseline only"],
      allowOther: true,
    });
  });

  it("rejects choice questions that do not provide exactly three options", () => {
    expect(
      normalizeQuestion({
        kind: "choice",
        question: "Which scope should I use?",
        options: ["Latest only", "All versions"],
      })
    ).toBeNull();
    expect(
      normalizeQuestion({
        kind: "choice",
        question: "Which scope should I use?",
        options: ["Latest", "All", "Baseline", "Other"],
      })
    ).toBeNull();
  });
});
