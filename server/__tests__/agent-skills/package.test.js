/* eslint-env jest, node */
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  listWorkspacePackages,
  parseSkillMarkdown,
  readPackageResource,
  saveWorkspacePackage,
  workspaceSkillNameExists,
} = require("../../agent-skills/package");

describe("Agent Skills packages", () => {
  let storageRoot;
  const previousStorage = process.env.STORAGE_DIR;

  beforeEach(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-skills-"));
    process.env.STORAGE_DIR = storageRoot;
  });

  afterEach(async () => {
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it("parses the required specification fields", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: meeting-review\ndescription: Review meeting documents.\nallowed-tools: bash python\nmetadata:\n  owner: standards\n---\n\n# Workflow\n"
    );
    expect(parsed).toMatchObject({
      valid: true,
      manifest: {
        name: "meeting-review",
        description: "Review meeting documents.",
        allowedTools: "bash python",
        metadata: { owner: "standards" },
      },
    });
  });

  it("rejects invalid names and directory mismatches", () => {
    expect(
      parseSkillMarkdown("---\nname: Bad_Name\ndescription: invalid\n---\n", {
        directoryName: "other",
      }).valid
    ).toBe(false);
  });

  it("saves and discovers a live workspace package", async () => {
    const skillMd =
      "---\nname: demo-skill\ndescription: A test skill.\n---\n\nRun the helper.\n";
    const saved = await saveWorkspacePackage(3, {
      skillMd,
      files: [
        {
          path: "scripts/demo.py",
          content: "print('ok')\n",
          encoding: "utf8",
        },
      ],
    });
    expect(saved.valid).toBe(true);
    const packages = await listWorkspacePackages(3);
    expect(packages).toHaveLength(1);
    expect(packages[0].manifest.name).toBe("demo-skill");
    await expect(workspaceSkillNameExists("demo-skill")).resolves.toBe(true);
    await expect(
      readPackageResource(packages[0].root, "scripts/demo.py")
    ).resolves.toMatchObject({ content: "print('ok')\n", binary: false });
  });

  it("rejects package traversal", async () => {
    await expect(
      saveWorkspacePackage(3, {
        skillMd: "---\nname: demo-skill\ndescription: A test skill.\n---\n",
        files: [{ path: "../escape.py", content: "bad" }],
      })
    ).rejects.toThrow("Invalid package path");
  });

  it("rejects an invalid previous package name", async () => {
    await expect(
      saveWorkspacePackage(
        3,
        {
          skillMd: "---\nname: demo-skill\ndescription: A test skill.\n---\n",
        },
        "../other-workspace"
      )
    ).rejects.toThrow("Invalid previous workspace skill name");
  });
});
