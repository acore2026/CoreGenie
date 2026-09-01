/* eslint-env jest, node */
const {
  safeWorkspaceFileName,
  isInboxFilePath,
  isRemovableUploadPath,
} = require("../../endpoints/workspaceFiles");

describe("workspace files", () => {
  it("normalizes filenames while preserving supported file types", () => {
    expect(safeWorkspaceFileName("proposal.docx")).toBe("proposal.docx");
    expect(safeWorkspaceFileName("../proposal.docx")).toBe(".._proposal.docx");
    expect(safeWorkspaceFileName("report.pdf")).toBe("report.pdf");
    expect(safeWorkspaceFileName("会议提案.docx")).toBe("会议提案.docx");
  });

  it("only accepts isolated DOCX inbox paths", () => {
    expect(
      isInboxFilePath("/workspace/3gpp-markdown/inbox/1234/S2-2600001.docx")
    ).toBe("3gpp-markdown/inbox/1234/S2-2600001.docx");
    expect(isInboxFilePath("3gpp-markdown/results/report.docx")).toBeNull();
    expect(
      isInboxFilePath("3gpp-markdown/inbox/1234/../../secret.docx")
    ).toBeNull();
  });

  it("only permits deletion of temporary prompt uploads", () => {
    expect(isRemovableUploadPath("/workspace/uploads/1234/report.pdf")).toBe(
      "uploads/1234/report.pdf"
    );
    expect(isRemovableUploadPath("research/report.pdf")).toBeNull();
    expect(
      isRemovableUploadPath("uploads/1234/../../research/report.pdf")
    ).toBeNull();
  });
});
