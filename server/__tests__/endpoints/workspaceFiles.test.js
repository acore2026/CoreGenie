/* eslint-env jest, node */
const AdmZip = require("adm-zip");
const {
  safeDocxName,
  validateDocxBuffer,
  isInboxFilePath,
} = require("../../endpoints/workspaceFiles");

function docxBuffer() {
  const archive = new AdmZip();
  archive.addFile("[Content_Types].xml", Buffer.from("<Types/>"));
  archive.addFile("word/document.xml", Buffer.from("<w:document/>"));
  return archive.toBuffer();
}

describe("workspace DOCX files", () => {
  it("accepts a DOCX package and rejects arbitrary ZIP data", () => {
    expect(validateDocxBuffer(docxBuffer())).toBe(true);
    const archive = new AdmZip();
    archive.addFile("notes.txt", Buffer.from("not docx"));
    expect(validateDocxBuffer(archive.toBuffer())).toBe(false);
    expect(validateDocxBuffer(Buffer.from("not a zip"))).toBe(false);
  });

  it("normalizes filenames without allowing another extension", () => {
    expect(safeDocxName("proposal.docx")).toBe("proposal.docx");
    expect(safeDocxName("../proposal.docx")).toBe(".._proposal.docx");
    expect(safeDocxName("proposal.pdf")).toBeNull();
  });

  it("only accepts isolated DOCX inbox paths", () => {
    expect(
      isInboxFilePath(
        "/workspace/3gpp-markdown/inbox/1234/S2-2600001.docx"
      )
    ).toBe("3gpp-markdown/inbox/1234/S2-2600001.docx");
    expect(isInboxFilePath("3gpp-markdown/results/report.docx")).toBeNull();
    expect(
      isInboxFilePath("3gpp-markdown/inbox/1234/../../secret.docx")
    ).toBeNull();
  });
});
