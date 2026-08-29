/* eslint-env jest, node */
jest.mock("../../agent-skills/registry", () => ({
  allowedToolIds: jest.fn((skill) => skill.allowedToolIds || []),
  resolveActivatedSkillSnapshot: jest.fn(),
  resolveAvailableSkill: jest.fn(),
}));
jest.mock("../../agent-skills/package", () => ({
  readPackageResource: jest.fn(),
}));

const {
  resolveActivatedSkillSnapshot,
  resolveAvailableSkill,
} = require("../../agent-skills/registry");
const { readPackageResource } = require("../../agent-skills/package");
const {
  activateSkill,
  readSkillResource,
  runtimeInstructions,
  runtimeSkillBody,
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

  it("removes disallowed tool IDs from activated Skill instructions", () => {
    const body = runtimeSkillBody(
      {
        instructions:
          "Use rag.search, knowledge.ingest, and memory.store when needed.",
        allowedToolIds: ["rag.search", "knowledge.ingest", "memory.store"],
      },
      new Set(["knowledge.search"])
    );

    expect(body).toContain("knowledge.search");
    expect(body).not.toContain("rag.search");
    expect(body).not.toContain("knowledge.ingest");
    expect(body).not.toContain("memory.store");
  });

  it("reads SKILL.md when it is advertised in the activated package", async () => {
    const skill = {
      name: "3gpp-review",
      scope: "global",
      revision: "sha256:current",
      root: "/private/package/root",
      files: [{ path: "SKILL.md" }, { path: "scripts/3gpp_tdocs.py" }],
    };
    resolveActivatedSkillSnapshot.mockResolvedValue(skill);
    resolveAvailableSkill.mockResolvedValue(skill);
    readPackageResource.mockResolvedValue({
      path: "SKILL.md",
      binary: false,
      content: "# 3GPP review",
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
      { name: "3gpp-review", path: "SKILL.md", offset: 0 },
      context
    );

    expect(result).toMatchObject({
      ok: true,
      code: "SKILL_RESOURCE_READ",
      summary: "Read SKILL.md.",
    });
    expect(readPackageResource).toHaveBeenCalledWith(skill.root, "SKILL.md", 0);
  });

  it("removes disallowed tool IDs from text Skill resources", async () => {
    const skill = {
      name: "safe-skill",
      scope: "global",
      revision: "sha256:safe",
      root: "/private/package/root",
      allowedToolIds: ["knowledge.search", "memory.store"],
      files: [{ path: "SKILL.md" }],
    };
    resolveActivatedSkillSnapshot.mockResolvedValue(skill);
    resolveAvailableSkill.mockResolvedValue(skill);
    readPackageResource.mockResolvedValue({
      path: "SKILL.md",
      binary: false,
      content: "Use knowledge.search or memory.store.",
    });
    const context = {
      agent: { id: 6 },
      workspace: { id: 1 },
      visibleToolIds: new Set(["knowledge.search"]),
      activatedSkill: jest.fn().mockReturnValue({ revision: "sha256:safe" }),
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const result = await readSkillResource.execute(
      { name: "safe-skill", path: "SKILL.md", offset: 0 },
      context
    );

    expect(result.data.content).toContain("knowledge.search");
    expect(result.data.content).not.toContain("memory.store");
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
    resolveActivatedSkillSnapshot.mockResolvedValue(skill);
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
    resolveActivatedSkillSnapshot.mockResolvedValue(skill);
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
          "SKILL.md",
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
