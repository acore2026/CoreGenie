jest.mock("../../models/predefinedAgentSkill", () => ({
  PredefinedAgentSkill: {
    getRevision: jest.fn(),
    whereIds: jest.fn(),
    all: jest.fn(),
  },
}));
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const {
  availableSkills,
  resolveAvailableSkill,
  resolveActivatedSkillSnapshot,
} = require("../../agent-skills/registry");

describe("pinned global Skill revisions", () => {
  const previous = {
    id: 1,
    name: "sample",
    manifest: { name: "sample", description: "Old skill" },
    revision: "old-revision",
    instructions: "old instructions",
    valid: true,
    files: [],
  };
  beforeEach(() => {
    jest.clearAllMocks();
    PredefinedAgentSkill.getRevision.mockResolvedValue(previous);
    PredefinedAgentSkill.whereIds.mockResolvedValue([
      { ...previous, revision: "new-revision" },
    ]);
  });
  it("keeps the initial catalog and activation on the run's recorded revision", async () => {
    const agent = {
      skillIds: [1],
      pinnedSkills: [{ id: 1, name: "sample", revision: "old-revision" }],
    };
    expect((await availableSkills(agent, null))[0].revision).toBe(
      "old-revision"
    );
    expect((await resolveAvailableSkill(agent, null, "sample")).revision).toBe(
      "old-revision"
    );
    expect(PredefinedAgentSkill.whereIds).not.toHaveBeenCalled();
  });
  it("restores a historical revision even if the active skill has changed", async () => {
    expect(
      (
        await resolveActivatedSkillSnapshot(
          { id: 1, name: "sample", scope: "global", revision: "old-revision" },
          null
        )
      ).revision
    ).toBe("old-revision");
    expect(PredefinedAgentSkill.getRevision).toHaveBeenCalledWith(
      1,
      "old-revision"
    );
  });
  it("fails explicitly when historical package data is unavailable", async () => {
    PredefinedAgentSkill.getRevision.mockResolvedValue(null);
    await expect(
      availableSkills(
        { pinnedSkills: [{ id: 1, name: "sample", revision: "missing" }] },
        null
      )
    ).rejects.toThrow("Skill revision unavailable");
  });
  it("uses current revisions when listing configuration outside a run", async () => {
    expect((await availableSkills({ skillIds: [1] }, null))[0].revision).toBe(
      "new-revision"
    );
  });
});
