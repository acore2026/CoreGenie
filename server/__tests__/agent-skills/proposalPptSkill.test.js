/* eslint-env jest, node */
const path = require("path");
const { loadPackage } = require("../../agent-skills/package");
const { ConfigFiles } = require("../../config-sync/files");

describe("3gpp-proposal-ppt repository Skill", () => {
  it("loads its executable package and is discoverable from an enabled Agent with its dependency", async () => {
    const root = path.resolve(__dirname, "../../../agent-config");
    const pkg = await loadPackage(path.join(root, "skills/3gpp-proposal-ppt"));
    expect(pkg.valid).toBe(true);
    expect(pkg.errors).toEqual([]);
    expect(pkg.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "SKILL.md",
        "scripts/proposal_ppt.py",
        "scripts/render_qa.py",
        "references/cards.md",
        "references/quality-check.md",
      ])
    );
    const definitions = await new ConfigFiles(root).list();
    const agent = definitions["agents/3gpp-general"].value;
    expect(agent.enabled).toBe(true);
    expect(agent.runtimeConfig.attachmentMode).toBe("workspace_file");
    expect(agent.skills).toEqual(
      expect.arrayContaining(["3gpp-proposal-ppt", "3gpp-review"])
    );
  });
});
