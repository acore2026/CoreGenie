/* eslint-env jest, node */
jest.mock("../../agent-skills/registry", () => ({
  resolveAvailableSkill: jest.fn(),
}));
jest.mock("../../agent-skills/package", () => ({
  readPackageResource: jest.fn(),
}));

const { resolveAvailableSkill } = require("../../agent-skills/registry");
const { readPackageResource } = require("../../agent-skills/package");
const {
  activateSkill,
  readSkillResource,
  runtimeInstructions,
} = require("../../tools/skills");

describe("governed Agent Skill activation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("makes the runtime package name authoritative after a skill rename", async () => {
    const skill = {
      id: 2,
      name: "3gpp-tdocs",
      scope: "global",
      revision: "sha256:legacy",
      instructions:
        "Run the helper with cwd=skill://3gpp-review from the old package name.",
      files: [],
    };
    resolveAvailableSkill.mockResolvedValue(skill);
    const context = {
      agent: { id: 6 },
      workspace: { id: 1 },
      activateSkill: jest.fn(),
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const result = await activateSkill.execute({ name: "3gpp-tdocs" }, context);

    expect(result).toMatchObject({
      ok: true,
      data: { skillRoot: "skill://3gpp-tdocs" },
    });
    expect(result.data.instructions).toContain(
      "Always pass `cwd=skill://3gpp-tdocs`"
    );
    expect(result.data.instructions).toContain(
      "ignore that example and use `skill://3gpp-tdocs` instead"
    );
    expect(context.activateSkill).toHaveBeenCalledWith(skill);
  });

  it("preserves the original instructions after the runtime note", () => {
    expect(
      runtimeInstructions({ name: "example", instructions: "Do the work." })
    ).toMatch(/skill:\/\/example[\s\S]*Do the work\.$/);
  });

  it("resolves a unique resource basename instead of probing guessed paths", async () => {
    const skill = {
      name: "3gpp-position-evolution",
      scope: "global",
      revision: "sha256:current",
      root: "/private/package/root",
      files: [
        { path: "SKILL.md" },
        { path: "references/status-semantics.md" },
        { path: "references/company-aliases.json" },
      ],
    };
    resolveAvailableSkill.mockResolvedValue(skill);
    readPackageResource.mockResolvedValue({
      path: "references/status-semantics.md",
      binary: false,
      content: "status rules",
    });
    const context = {
      agent: { id: 6 },
      workspace: { id: 1 },
      activatedSkill: jest.fn().mockReturnValue({
        revision: "sha256:current",
      }),
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const result = await readSkillResource.execute(
      {
        name: "3gpp-position-evolution",
        path: "resources/status-semantics",
        offset: 0,
      },
      context
    );

    expect(result).toMatchObject({
      ok: true,
      code: "SKILL_RESOURCE_READ",
      summary:
        "Read references/status-semantics.md (resolved from resources/status-semantics).",
    });
    expect(readPackageResource).toHaveBeenCalledWith(
      skill.root,
      "references/status-semantics.md",
      0
    );
  });

  it("returns the exact file list once when a resource cannot be resolved", async () => {
    const skill = {
      name: "3gpp-position-evolution",
      scope: "global",
      revision: "sha256:current",
      root: "/private/package/root",
      files: [
        { path: "SKILL.md" },
        { path: "references/status-semantics.md" },
        { path: "references/evidence-taxonomy.md" },
        { path: "scripts/3gpp_evolution.py" },
      ],
    };
    resolveAvailableSkill.mockResolvedValue(skill);
    const context = {
      agent: { id: 6 },
      workspace: { id: 1 },
      activatedSkill: jest.fn().mockReturnValue({
        revision: "sha256:current",
      }),
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const result = await readSkillResource.execute(
      {
        name: "3gpp-position-evolution",
        path: "missing-resource",
        offset: 0,
      },
      context
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SKILL_RESOURCE_NOT_FOUND",
      retryable: false,
      data: {
        requestedPath: "missing-resource",
        availablePaths: [
          "references/status-semantics.md",
          "references/evidence-taxonomy.md",
          "scripts/3gpp_evolution.py",
        ],
      },
    });
    expect(result.summary).toContain("Do not guess another path");
    expect(readPackageResource).not.toHaveBeenCalled();
  });
});
