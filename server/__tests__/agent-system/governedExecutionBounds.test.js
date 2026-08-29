/* eslint-env jest, node */
const {
  DEFAULTS,
  blockedTaskResults,
  taskCanDispatch,
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
});
