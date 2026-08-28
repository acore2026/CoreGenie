/* eslint-env jest, node */
const {
  DEFAULT_RUNTIME_KEY,
  EVIDENCE_RESEARCH_RUNTIME_KEY,
  LEGACY_DEFAULT_RUNTIME_KEY,
  normalizeRuntimeConfig,
  requireRuntime,
  runtimeOptions,
} = require("../../agent-system/runtimes/registry");

describe("Agent runtime registry", () => {
  it("exposes only the governed runtime for new Agents", () => {
    expect(runtimeOptions()).toEqual([
      expect.objectContaining({
        key: DEFAULT_RUNTIME_KEY,
        version: 1,
        experimental: false,
        modelRoles: ["controller", "worker", "reviewer", "vision"],
      }),
    ]);
  });

  it("validates role models and strips unknown runtime fields", () => {
    expect(
      normalizeRuntimeConfig(EVIDENCE_RESEARCH_RUNTIME_KEY, {
        plannerModel: "planner-v1",
        workerModel: null,
        requiredCompletionTools: ["knowledge.publish"],
        unknown: "ignored",
      })
    ).toEqual({
      plannerModel: "planner-v1",
      workerModel: null,
      requiredCompletionTools: ["knowledge.publish"],
    });
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
    expect(requireRuntime(LEGACY_DEFAULT_RUNTIME_KEY, 1).runtime).toBeTruthy();
    expect(
      requireRuntime(EVIDENCE_RESEARCH_RUNTIME_KEY, 1).runtime
    ).toBeTruthy();
  });
});
