/* eslint-env jest, node */
const mockManager = {
  validatePath: jest.fn(),
  getAllowedDirectories: jest.fn(() => ["/storage/workspace-2"]),
};
const mockCollector = {
  online: jest.fn(),
  parseDocument: jest.fn(),
};

jest.mock("fs/promises", () => ({
  lstat: jest.fn(),
  readFile: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
  rm: jest.fn(),
}));
jest.mock("../../utils/collectorApi", () => ({
  CollectorApi: jest.fn(() => mockCollector),
}));
jest.mock("../../utils/agents/aibitat/plugins/filesystem/lib", () => ({
  forWorkspace: jest.fn(() => mockManager),
}));
jest.mock("../../models/globalDocuments", () => ({
  GlobalDocument: {
    all: jest.fn(),
    get: jest.fn(),
    addDocuments: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock("../../utils/files", () => ({
  directUploadsPath: "/storage/direct-uploads",
  documentsPath: "/storage/documents",
}));

const fs = require("fs/promises");
const { GlobalDocument } = require("../../models/globalDocuments");
const {
  listGlobalKnowledge,
  ingestGlobalKnowledge,
  replaceGlobalKnowledge,
  removeGlobalKnowledge,
} = require("../../tools/globalKnowledge");

function context() {
  return {
    workspace: { id: 2, slug: "team", name: "Team" },
    user: { id: 9, username: "member", role: "default" },
    agent: { id: 3, name: "General Agent" },
    emit: jest.fn(),
  };
}

function record(id, docpath = "global-rag-ingest/hash-document.pdf.json") {
  return {
    id,
    docId: `doc-${id}`,
    filename: pathBasename(docpath),
    docpath,
    metadata: JSON.stringify({ title: `Document ${id}`, ragScope: "global" }),
    createdAt: new Date("2026-09-11T00:00:00.000Z"),
  };
}

function pathBasename(value) {
  return value.split("/").pop();
}

describe("global knowledge Agent tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    GlobalDocument.all.mockReset();
    GlobalDocument.get.mockReset();
    GlobalDocument.addDocuments.mockReset();
    GlobalDocument.delete.mockReset();
    mockManager.validatePath.mockResolvedValue(
      "/storage/workspace-2/uploads/document.pdf"
    );
    fs.lstat.mockResolvedValue({
      isFile: () => true,
      isSymbolicLink: () => false,
      size: 2048,
    });
    fs.readFile.mockResolvedValue(Buffer.from("global knowledge content"));
    fs.rm.mockResolvedValue(undefined);
    mockCollector.online.mockResolvedValue(true);
    mockCollector.parseDocument.mockResolvedValue({
      success: true,
      documents: [
        {
          id: "parsed-id",
          title: "Shared specification",
          pageContent: "content",
          location: "custom-documents/temporary.json",
        },
      ],
    });
  });

  it("lists shared documents for a regular member", async () => {
    GlobalDocument.all.mockResolvedValue([record(4)]);
    const ctx = context();

    const result = await listGlobalKnowledge.execute({}, ctx);

    expect(result).toMatchObject({
      ok: true,
      code: "GLOBAL_KNOWLEDGE_LISTED",
      data: { documents: [{ id: 4, title: "Document 4" }] },
    });
    expect(ctx.user.role).toBe("default");
  });

  it("lets a regular member add a Workspace file to global RAG", async () => {
    const added = record(7);
    GlobalDocument.get.mockResolvedValueOnce(null).mockResolvedValueOnce(added);
    GlobalDocument.addDocuments.mockImplementation(async (paths) => ({
      embedded: paths,
      failedToEmbed: [],
      errors: [],
    }));
    const ctx = context();

    const result = await ingestGlobalKnowledge.execute(
      { paths: ["uploads/document.pdf"] },
      ctx
    );

    expect(result).toMatchObject({
      ok: true,
      code: "GLOBAL_KNOWLEDGE_INGESTED",
      data: { documents: [{ id: 7 }] },
    });
    expect(GlobalDocument.addDocuments).toHaveBeenCalledWith(
      [expect.stringMatching(/^global-rag-ingest\/.+document\.pdf\.json$/)],
      9
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("/storage/documents/global-rag-ingest/"),
      expect.stringContaining('"ragScope":"global"'),
      "utf8"
    );
    expect(ctx.emit).toHaveBeenCalledWith(
      "global_knowledge.ingested",
      expect.objectContaining({ workspaceId: 2, added: 1 })
    );
  });

  it("embeds a replacement before deleting the previous document", async () => {
    const previous = record(2, "old.json");
    const replacement = record(8);
    const order = [];
    GlobalDocument.get
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replacement);
    GlobalDocument.addDocuments.mockImplementation(async (paths) => {
      order.push("add");
      return { embedded: paths, failedToEmbed: [], errors: [] };
    });
    GlobalDocument.delete.mockImplementation(async () => {
      order.push("delete");
      return true;
    });

    const result = await replaceGlobalKnowledge.execute(
      { id: 2, path: "uploads/document.pdf" },
      context()
    );

    expect(result).toMatchObject({
      ok: true,
      code: "GLOBAL_DOCUMENT_REPLACED",
      data: { previous: { id: 2 }, replacements: [{ id: 8 }] },
    });
    expect(order).toEqual(["add", "delete"]);
    expect(GlobalDocument.delete).toHaveBeenCalledWith(2, 9);
  });

  it("removes a shared document for a regular member", async () => {
    GlobalDocument.get.mockResolvedValue(record(5));
    GlobalDocument.delete.mockResolvedValue(true);

    const result = await removeGlobalKnowledge.execute({ id: 5 }, context());

    expect(result).toMatchObject({
      ok: true,
      code: "GLOBAL_DOCUMENT_REMOVED",
    });
    expect(GlobalDocument.delete).toHaveBeenCalledWith(5, 9);
  });

  it("marks replacement and removal as destructive operations", () => {
    expect(ingestGlobalKnowledge.effect).toBe("write");
    expect(replaceGlobalKnowledge.effect).toBe("destructive");
    expect(removeGlobalKnowledge.effect).toBe("destructive");
  });
});
