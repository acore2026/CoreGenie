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
  it("keeps original-file uploads available to ReAct document skills", () => {
    expect(normalizeRuntimeConfig(LEGACY_DEFAULT_RUNTIME_KEY, { attachmentMode: "workspace_file" })).toEqual({ attachmentMode: "workspace_file" });
  });
  it("exposes every selectable Agent runtime", () => {
    expect(runtimeOptions()).toEqual([
      expect.objectContaining({
        key: LEGACY_DEFAULT_RUNTIME_KEY,
        label: "ReAct",
        version: 1,
        experimental: false,
        modelRoles: [],
      }),
      expect.objectContaining({
        key: DEFAULT_RUNTIME_KEY,
        label: "Orchestrated",
        version: 1,
        experimental: false,
        modelRoles: ["controller", "worker", "reviewer", "vision"],
      }),
      expect.objectContaining({
        key: EVIDENCE_RESEARCH_RUNTIME_KEY,
        label: "研究",
        version: 1,
        experimental: true,
        modelRoles: ["planner", "worker", "reviewer"],
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
      attachmentMode: "parsed",
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

  it("keeps the fixed 3GPP conversion workflow in the run snapshot config", () => {
    expect(
      normalizeRuntimeConfig(DEFAULT_RUNTIME_KEY, {
        attachmentMode: "workspace_file",
        workflow: "3gpp-markdown-conversion",
        thinking: false,
      })
    ).toEqual({
      attachmentMode: "workspace_file",
      workflow: "3gpp-markdown-conversion",
      thinking: false,
      requiredCompletionTools: [],
    });
  });

  it("keeps the direct runtime model-call override", () => {
    expect(
      normalizeRuntimeConfig(LEGACY_DEFAULT_RUNTIME_KEY, {
        maxRuntimeMs: 3_600_000,
        disableModelCallLimit: true,
        visionModel: "qwen3.7-plus",
      })
    ).toEqual({
      maxRuntimeMs: 3_600_000,
      disableModelCallLimit: true,
      visionModel: "qwen3.7-plus",
    });
  });

  it("allows bounded proposal analysis without claiming full meeting coverage", () => {
    const fs = require("fs");
    const path = require("path");
    const YAML = require("yaml");
    const agent = YAML.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../agent-config/agents/3gpp-review.yaml"
        ),
        "utf8"
      )
    );
    expect(
      normalizeRuntimeConfig(agent.runtimeKey, agent.runtimeConfig)
    ).toMatchObject({ publicationRequiresCoverage: false });
    expect(
      normalizeRuntimeConfig(agent.runtimeKey, {
        ...agent.runtimeConfig,
        publicationRequiresCoverage: true,
      })
    ).toMatchObject({ publicationRequiresCoverage: true });
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
