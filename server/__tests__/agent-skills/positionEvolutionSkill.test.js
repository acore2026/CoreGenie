/* eslint-env jest, node */
const path = require("path");
const { loadPackage } = require("../../agent-skills/package");

describe("3gpp-position-evolution example Skill", () => {
  it("is a valid, self-contained package with deterministic helpers", async () => {
    const root = path.join(
      __dirname,
      "../../agent-skills/examples/3gpp-position-evolution"
    );
    const pkg = await loadPackage(root, {
      directoryName: "3gpp-position-evolution",
    });

    expect(pkg.valid).toBe(true);
    expect(pkg.errors).toEqual([]);
    expect(pkg.manifest.name).toBe("3gpp-position-evolution");
    expect(pkg.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "SKILL.md",
        "scripts/3gpp_evolution.py",
        "references/evidence-taxonomy.md",
        "references/status-semantics.md",
        "references/report-contract.md",
      ])
    );
  });
});
