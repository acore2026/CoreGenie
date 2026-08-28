/* eslint-env jest, node */
const mockManager = {
  validatePath: jest.fn(),
  writeFileContent: jest.fn(),
};

jest.mock("fs/promises", () => ({
  appendFile: jest.fn(),
  readdir: jest.fn(),
}));
jest.mock("../../utils/agents/aibitat/plugins/filesystem/lib", () => ({
  forWorkspace: jest.fn(() => mockManager),
}));

const fs = require("fs/promises");
const { writeFile } = require("../../tools/filesystem");

describe("filesystem.write", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.validatePath.mockResolvedValue("/storage/workspace-2/report.md");
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
