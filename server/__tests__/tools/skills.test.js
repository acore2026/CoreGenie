/* eslint-env jest, node */
jest.mock("../../agent-skills/registry", () => ({
  resolveAvailableSkill: jest.fn(),
}));

const { resolveAvailableSkill } = require("../../agent-skills/registry");
const { activateSkill, runtimeInstructions } = require("../../tools/skills");

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
});
