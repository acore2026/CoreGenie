/* eslint-env jest, node */
const path = require("path");
const { loadPackage } = require("../../agent-skills/package");

describe("3gpp-review-direct example Skill", () => {
  it("keeps the original helper in a valid single-context package", async () => {
    const root = path.join(
      __dirname,
      "../../agent-skills/examples/3gpp-review-direct"
    );
    const pkg = await loadPackage(root, {
      directoryName: "3gpp-review-direct",
    });

    expect(pkg.valid).toBe(true);
    expect(pkg.errors).toEqual([]);
    expect(pkg.manifest.name).toBe("3gpp-review-direct");
    expect(pkg.manifest.allowedTools).not.toContain("knowledge.publish");
    expect(pkg.body).toContain("one continuous Agent conversation");
    expect(pkg.body).toContain("Do not delegate batches");
    expect(pkg.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["SKILL.md", "scripts/3gpp_tdocs.py"])
    );
  });
});
