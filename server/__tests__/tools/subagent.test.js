/* eslint-env jest, node */
const { inheritedSkillSnapshots } = require("../../tools/subagent");

describe("subagent Skill inheritance", () => {
  it("passes every activated Skill as a serializable child snapshot", () => {
    const context = {
      activatedSkills: () => [
        {
          id: 10,
          name: "3gpp-review",
          scope: "global",
          revision: "sha256:review",
          root: "/private/skill/package",
          allowedTools: "bash web.fetch",
          instructions: "Review TDocs.",
          files: [{ path: "scripts/3gpp_tdocs.py", text: true }],
        },
        {
          id: 11,
          name: "3gpp-position-evolution",
          scope: "global",
          revision: "sha256:evolution",
          allowedTools: "filesystem.read",
          instructions: "Trace positions.",
          files: [],
        },
      ],
    };

    const inherited = inheritedSkillSnapshots(context);
    expect(inherited.map((skill) => skill.name)).toEqual([
      "3gpp-review",
      "3gpp-position-evolution",
    ]);
    expect(inherited[0]).toMatchObject({
      revision: "sha256:review",
      skillRoot: "skill://3gpp-review",
      instructions: "Review TDocs.",
    });
    expect(inherited[0]).not.toHaveProperty("root");
  });
});
