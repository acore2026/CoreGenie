/* eslint-env jest, node */
const {
  DEFAULT_AGENT_CONCURRENCY,
  agentMaxConcurrency,
  boundedConcurrency,
} = require("../../agent-system/concurrency");

describe("Agent task concurrency", () => {
  const original = process.env.AGENT_MAX_CONCURRENCY;

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_MAX_CONCURRENCY;
    else process.env.AGENT_MAX_CONCURRENCY = original;
  });

  it("uses the higher shared default", () => {
    delete process.env.AGENT_MAX_CONCURRENCY;
    expect(DEFAULT_AGENT_CONCURRENCY).toBe(12);
    expect(agentMaxConcurrency()).toBe(12);
    expect(
      require("../../agent-system/runtimes/governed").DEFAULTS.maxConcurrency
    ).toBe(12);
  });

  it("accepts an override and keeps it within safe bounds", () => {
    process.env.AGENT_MAX_CONCURRENCY = "8";
    expect(agentMaxConcurrency()).toBe(8);
    expect(boundedConcurrency(0)).toBe(1);
    expect(boundedConcurrency(99)).toBe(64);
    expect(boundedConcurrency("invalid")).toBe(12);
  });
});
