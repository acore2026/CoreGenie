/* eslint-env jest, node */
const mockFileStats = { isFile: () => true, size: 1024 };
const mockManager = {
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  validatePath: jest
    .fn()
    .mockResolvedValue("/tmp/workspace/3gpp-markdown/inbox/123/proposal.docx"),
};

jest.mock("fs/promises", () => ({ stat: jest.fn(() => mockFileStats) }));
jest.mock("../../utils/agents/aibitat/plugins/filesystem/lib", () => ({
  forWorkspace: jest.fn(() => mockManager),
}));

const {
  WORKSPACE_FILE_MIME,
  normalizeAgentAttachments,
  workspaceFileRelativePath,
} = require("../../agent-system/attachments");

describe("Agent workspace file attachments", () => {
  const attachment = {
    name: "proposal.docx",
    mime: WORKSPACE_FILE_MIME,
    contentString: "/workspace/3gpp-markdown/inbox/123/proposal.docx",
  };

  it("normalizes a raw workspace file for any Agent", async () => {
    await expect(
      normalizeAgentAttachments({
        attachments: [attachment],
        workspace: { id: 9 },
        agent: { runtimeConfig: { attachmentMode: "parsed" } },
      })
    ).resolves.toEqual([attachment]);
    expect(mockManager.validatePath).toHaveBeenCalledWith(
      "3gpp-markdown/inbox/123/proposal.docx"
    );
  });

  it("accepts normal workspace paths and rejects traversal", () => {
    expect(workspaceFileRelativePath("/workspace/other/file.docx")).toBe(
      "other/file.docx"
    );
    expect(
      workspaceFileRelativePath(
        "/workspace/3gpp-markdown/inbox/123/../../file.docx"
      )
    ).toBeNull();
  });
});
