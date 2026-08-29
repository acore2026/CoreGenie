/* eslint-env jest, node */
jest.mock("../../agent-skills/registry", () => ({
  allowedToolIds: jest.fn((skill) =>
    String(skill?.allowedTools || "")
      .split(/\s+/)
      .filter(Boolean)
  ),
  resolveActivatedSkillSnapshot: jest.fn(),
  resolveAvailableSkill: jest.fn(),
}));

const {
  resolveActivatedSkillSnapshot,
} = require("../../agent-skills/registry");
const {
  activatedSkillSnapshot,
  activatedSkillsPrompt,
  mergeActivatedSkills,
  restoreActivatedSkills,
} = require("../../agent-system/activatedSkills");

describe("activated Skill run context", () => {
  const skill = {
    id: 10,
    key: "global:3gpp-review",
    name: "3gpp-review",
    scope: "global",
    revision: "sha256:review-v1",
    description: "Review TDocs",
    allowedTools: "bash web.fetch",
    instructions: "Resolve the official meeting before downloading TDocs.",
    files: [{ path: "scripts/3gpp_tdocs.py", size: 100, text: true }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveActivatedSkillSnapshot.mockResolvedValue(skill);
  });

  it("creates a serializable snapshot and injects complete instructions", () => {
    const snapshot = activatedSkillSnapshot(skill);
    expect(snapshot).toEqual(
      expect.objectContaining({
        name: "3gpp-review",
        revision: "sha256:review-v1",
        skillRoot: "skill://3gpp-review",
      })
    );
    expect(snapshot).not.toHaveProperty("root");
    expect(activatedSkillsPrompt([snapshot], new Set(["bash"]))).toMatch(
      /activated_agent_skill[\s\S]*Resolve the official meeting[\s\S]*scripts\/3gpp_tdocs\.py/
    );
  });

  it("merges activated Skills by name without duplicate activation", () => {
    expect(
      mergeActivatedSkills(
        [activatedSkillSnapshot(skill)],
        [activatedSkillSnapshot({ ...skill, revision: "sha256:review-v2" })]
      )
    ).toEqual([
      expect.objectContaining({
        name: "3gpp-review",
        revision: "sha256:review-v2",
      }),
    ]);
  });

  it("restores inherited Skills into an isolated downstream scope", async () => {
    const parentScope = new Map([[skill.name, skill]]);
    const childScope = new Map();
    await restoreActivatedSkills(
      [activatedSkillSnapshot(skill)],
      { id: 1 },
      childScope
    );

    expect(childScope.get(skill.name)).toEqual(skill);
    expect(childScope).not.toBe(parentScope);
  });

  it("rejects a changed Skill revision before downstream execution", async () => {
    resolveActivatedSkillSnapshot.mockResolvedValue({
      ...skill,
      revision: "sha256:review-v2",
    });

    await expect(
      restoreActivatedSkills(
        [activatedSkillSnapshot(skill)],
        { id: 1 },
        new Map()
      )
    ).rejects.toMatchObject({
      code: "ACTIVATED_SKILL_REVISION_CHANGED",
      retryable: false,
    });
  });
});
