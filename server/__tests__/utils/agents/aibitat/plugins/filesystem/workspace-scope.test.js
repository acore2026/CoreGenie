const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const filesystem = require("../../../../../../utils/agents/aibitat/plugins/filesystem/lib");

describe("filesystem workspace scoping", () => {
  let storageRoot;
  let previousStorageDir;

  beforeEach(async () => {
    previousStorageDir = process.env.STORAGE_DIR;
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anythingllm-fs-"));
    process.env.STORAGE_DIR = storageRoot;
  });

  afterEach(async () => {
    if (previousStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorageDir;
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it("persists files inside one stable workspace directory", async () => {
    const firstInvocation = filesystem.forWorkspace(7);
    const filePath = await firstInvocation.validatePath("result.txt");
    await firstInvocation.writeFileContent(filePath, "persistent");

    const laterInvocation = filesystem.forWorkspace(7);
    const sameFile = await laterInvocation.validatePath("result.txt");
    await expect(laterInvocation.readFileContent(sameFile)).resolves.toBe(
      "persistent",
    );
    expect(sameFile).toContain(
      path.join("anythingllm-fs", "workspaces", "workspace-7"),
    );
  });

  it("prevents another workspace from accessing the file", async () => {
    const workspaceOne = filesystem.forWorkspace(1);
    const workspaceTwo = filesystem.forWorkspace(2);
    const privatePath = await workspaceOne.validatePath("private.txt");
    await workspaceOne.writeFileContent(privatePath, "workspace one");

    await expect(workspaceTwo.validatePath(privatePath)).rejects.toThrow(
      "Access denied",
    );
  });

  it("requires authenticated workspace state", () => {
    expect(() => filesystem.forInvocation({})).toThrow(
      "Authenticated workspace is required",
    );
  });

  it("deletes files and directories but never the workspace root", async () => {
    const manager = filesystem.forWorkspace(7);
    const filePath = await manager.validatePath("remove-me.txt");
    await manager.writeFileContent(filePath, "temporary");
    await expect(manager.deletePath("remove-me.txt")).resolves.toMatchObject({
      type: "file",
    });
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });

    const nestedFile = await manager.validatePath("old/nested.txt");
    await fs.mkdir(path.dirname(nestedFile), { recursive: true });
    await manager.writeFileContent(nestedFile, "temporary");
    await expect(
      manager.deletePath("old", { recursive: true }),
    ).resolves.toMatchObject({ type: "directory" });

    const targetPath = await manager.validatePath("keep-me.txt");
    await manager.writeFileContent(targetPath, "persistent");
    const linkPath = path.join(path.dirname(targetPath), "remove-link.txt");
    await fs.symlink(targetPath, linkPath);
    await manager.deletePath("remove-link.txt");
    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("persistent");

    const [workspaceRoot] = manager.getAllowedDirectories();
    await expect(manager.deletePath(workspaceRoot)).rejects.toThrow(
      "workspace root cannot be deleted",
    );
  });
});
