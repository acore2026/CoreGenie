/* eslint-env jest, node */
const mockManager = {
  validatePath: jest.fn(),
  writeFileContent: jest.fn(),
  readFileContent: jest.fn(),
  getAllowedDirectories: jest.fn(() => ["/storage/workspace-2"]),
  searchFilesWithGlob: jest.fn(),
};

jest.mock("fs/promises", () => ({
  appendFile: jest.fn(),
  readdir: jest.fn(),
}));
jest.mock("../../utils/agents/aibitat/plugins/filesystem/lib", () => ({
  forWorkspace: jest.fn(() => mockManager),
}));

const fs = require("fs/promises");
const {
  readFile,
  writeFile,
  listDirectory,
} = require("../../tools/filesystem");

describe("filesystem.read", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.validatePath.mockResolvedValue(
      "/storage/workspace-2/sources/SA2176_KI18_tdocs.txt"
    );
  });

  it("returns resolved same-name paths when an exact read path is missing", async () => {
    const error = new Error("ENOENT: no such file or directory");
    error.code = "ENOENT";
    mockManager.readFileContent.mockRejectedValue(error);
    mockManager.searchFilesWithGlob.mockResolvedValue([
      "/storage/workspace-2/work/SA2176_KI18_tdocs.txt",
    ]);

    const result = await readFile.execute(
      { path: "sources/SA2176_KI18_tdocs.txt" },
      { workspace: { id: 2 } }
    );

    expect(result).toMatchObject({
      ok: false,
      code: "WORKSPACE_FILE_NOT_FOUND",
      data: {
        suggestions: ["work/SA2176_KI18_tdocs.txt"],
      },
    });
  });

  it("routes Skill resource URIs away from the workspace filesystem", async () => {
    const result = await readFile.execute(
      { path: "skill://3gpp-review/SKILL.md" },
      { workspace: { id: 2 } }
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SKILL_URI_NOT_WORKSPACE_PATH",
      data: {
        skillName: "3gpp-review",
        resourcePath: "SKILL.md",
      },
    });
    expect(result.summary).toContain(
      'read_skill_resource with name="3gpp-review" and path="SKILL.md"'
    );
    expect(mockManager.validatePath).not.toHaveBeenCalled();
  });

  it("does not turn a Skill root into a workspace directory", async () => {
    const result = await listDirectory.execute(
      { path: "skill://3gpp-review" },
      { workspace: { id: 2 } }
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SKILL_URI_NOT_WORKSPACE_PATH",
      data: {
        skillName: "3gpp-review",
        resourcePath: null,
      },
    });
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(mockManager.validatePath).not.toHaveBeenCalled();
  });
});

describe("filesystem.write", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.validatePath.mockResolvedValue(
      "/storage/workspace-2/report.md"
    );
  });

  it("replaces a workspace file by default", async () => {
    const result = await writeFile.execute(
      { path: "/workspace/report.md", content: "header", append: false },
      { workspace: { id: 2 } }
    );

    expect(mockManager.writeFileContent).toHaveBeenCalledWith(
      "/storage/workspace-2/report.md",
      "header"
    );
    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(result).toMatch(/^Wrote /);
  });

  it("appends bounded report sections", async () => {
    const result = await writeFile.execute(
      { path: "/workspace/report.md", content: "\nsection", append: true },
      { workspace: { id: 2 } }
    );

    expect(fs.appendFile).toHaveBeenCalledWith(
      "/storage/workspace-2/report.md",
      "\nsection",
      "utf8"
    );
    expect(mockManager.writeFileContent).not.toHaveBeenCalled();
    expect(result).toMatch(/^Appended /);
  });
});
