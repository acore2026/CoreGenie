/* eslint-env jest, node */
const {
  UNBOUNDED_RECURSION_LIMIT,
  executionLimitsDisabled,
  recursionLimitFor,
} = require("../../agent-system/executionLimits");

describe("Agent execution limit override", () => {
  it("keeps the configured bound by default", () => {
    const run = { configuration: {} };

    expect(executionLimitsDisabled(run)).toBe(false);
    expect(recursionLimitFor(run, 800)).toBe(800);
  });

  it("uses a practical unbounded recursion limit when enabled", () => {
    const run = { configuration: { disableExecutionLimits: true } };

    expect(executionLimitsDisabled(run)).toBe(true);
    expect(recursionLimitFor(run, 800)).toBe(UNBOUNDED_RECURSION_LIMIT);
  });
});
