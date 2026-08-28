/* eslint-env jest, node */
const {
  applicableCompletionTools,
} = require("../../agent-system/executor");

describe("Agent run completion requirements", () => {
  it("does not require publication for a task that cannot publish", () => {
    expect(
      applicableCompletionTools(["knowledge.publish"], [
        { allowedToolIds: ["web.search"] },
      ])
    ).toEqual([]);
  });

  it("keeps publication required for a task that can publish", () => {
    expect(
      applicableCompletionTools(["knowledge.publish"], [
        {
          allowedToolIds: ["filesystem.write", "knowledge.publish"],
        },
      ])
    ).toEqual(["knowledge.publish"]);
  });
});
