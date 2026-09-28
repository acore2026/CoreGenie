/* eslint-env jest, node */
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  fallbackDownloadName,
  getGlobalKnowledgeDownload,
  preserveGlobalKnowledgeSource,
  removeGlobalKnowledgeSource,
  sourcePath,
} = require("../../utils/globalKnowledge");

describe("global knowledge downloads", () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "global-knowledge-test-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("preserves an uploaded source using an isolated storage name", async () => {
    const upload = path.join(root, "upload.tmp");
    await fs.writeFile(upload, "original contents");

    const source = await preserveGlobalKnowledgeSource(
      upload,
      "../共享资料.pdf",
      root
    );

    expect(source.originalName).toBe("共享资料.pdf");
    expect(source.storageName).toMatch(/^[a-f0-9-]+\.pdf$/);
    expect(
      await fs.readFile(sourcePath(source.storageName, root), "utf8")
    ).toBe("original contents");
    expect(sourcePath("../outside.pdf", root)).toBeNull();

    await removeGlobalKnowledgeSource(source.storageName, root);
    await expect(
      fs.access(sourcePath(source.storageName, root))
    ).rejects.toThrow();
  });

  it("downloads a preserved original when it is available", async () => {
    const stored = "3f519be0-5074-497f-96f1-92acf80c1ba1.docx";
    await fs.writeFile(path.join(root, stored), "docx bytes");

    const download = await getGlobalKnowledgeDownload(
      {
        filename: "parsed.json",
        docpath: "custom-documents/parsed.json",
        metadata: JSON.stringify({
          title: "提案.docx",
          sourceFile: { storageName: stored, originalName: "提案.docx" },
        }),
      },
      { root, readDocument: jest.fn() }
    );

    expect(download).toEqual({
      kind: "file",
      path: path.join(root, stored),
      filename: "提案.docx",
    });
  });

  it("falls back to readable extracted text for older records", async () => {
    const readDocument = jest.fn().mockResolvedValue({
      pageContent: "extracted content",
    });
    const download = await getGlobalKnowledgeDownload(
      {
        filename: "parsed.json",
        docpath: "custom-documents/parsed.json",
        metadata: JSON.stringify({ title: "旧资料.pdf" }),
      },
      { root, readDocument }
    );

    expect(download).toEqual({
      kind: "text",
      content: "extracted content",
      filename: "旧资料.txt",
    });
    expect(fallbackDownloadName("原始资料.md")).toBe("原始资料.md");
  });
});
