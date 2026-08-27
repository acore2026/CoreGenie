/* eslint-env jest, node */
const {
  DEFAULT_RUNTIME_KEY,
  EVIDENCE_RESEARCH_RUNTIME_KEY,
  normalizeRuntimeConfig,
  requireRuntime,
  runtimeOptions,
} = require("../../agent-system/runtimes/registry");

describe("Agent runtime registry", () => {
  it("keeps the existing runtime as the stable default", () => {
    expect(runtimeOptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: DEFAULT_RUNTIME_KEY,
          version: 1,
          experimental: false,
        }),
        expect.objectContaining({
          key: EVIDENCE_RESEARCH_RUNTIME_KEY,
          version: 1,
          experimental: true,
          modelRoles: ["planner", "worker", "reviewer"],
        }),
      ])
    );
  });

  it("validates role models and strips unknown runtime fields", () => {
    expect(
      normalizeRuntimeConfig(EVIDENCE_RESEARCH_RUNTIME_KEY, {
        plannerModel: "planner-v1",
        workerModel: null,
        unknown: "ignored",
      })
    ).toEqual({ plannerModel: "planner-v1", workerModel: null });
    expect(() =>
      normalizeRuntimeConfig(EVIDENCE_RESEARCH_RUNTIME_KEY, {
        reviewerModel: "",
      })
    ).toThrow();
  });

  it("never silently changes a snapshotted runtime version", () => {
    expect(() => requireRuntime(DEFAULT_RUNTIME_KEY, 999)).toThrow(
      /version 999 is unavailable/
    );
    expect(() => requireRuntime("missing-runtime", 1)).toThrow(/not installed/);
  });
});
