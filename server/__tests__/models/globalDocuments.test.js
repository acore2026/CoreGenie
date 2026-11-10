/* eslint-env jest, node */
const mockPrisma = {
  global_documents: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  document_vectors: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockVectorDb = {
  addDocumentToNamespace: jest.fn(),
  deleteDocumentFromNamespace: jest.fn(),
};

jest.mock("../../utils/prisma", () => mockPrisma);
jest.mock("../../utils/helpers", () => ({
  getVectorDbClass: () => mockVectorDb,
}));
jest.mock("../../utils/files", () => ({
  fileData: jest.fn(async () => ({
    pageContent: "shared content",
    title: "Shared document",
    docSource: "upload",
  })),
}));
jest.mock("../../models/eventLogs", () => ({
  EventLogs: { logEvent: jest.fn(async () => null) },
}));
jest.mock("../../models/vectors", () => ({ DocumentVectors: {} }));
jest.mock("../../models/systemSettings", () => ({ SystemSettings: { isMultiUserMode: jest.fn(async () => true) } }));

const { GlobalDocument } = require("../../models/globalDocuments");
const {
  GLOBAL_KNOWLEDGE_NAMESPACE,
} = require("../../utils/globalKnowledge");

describe("GlobalDocument", () => {
  beforeEach(() => jest.clearAllMocks());

  it("embeds a document once in the global namespace", async () => {
    mockPrisma.global_documents.findFirst.mockResolvedValue(null);
    mockVectorDb.addDocumentToNamespace.mockResolvedValue({ vectorized: true });
    mockPrisma.global_documents.create.mockResolvedValue({ id: 1 });

    const result = await GlobalDocument.addDocuments(["uploads/shared.json"], 7);

    expect(mockVectorDb.addDocumentToNamespace).toHaveBeenCalledWith(
      GLOBAL_KNOWLEDGE_NAMESPACE,
      expect.objectContaining({ ragScope: "global" }),
      "uploads/shared.json"
    );
    expect(mockPrisma.global_documents.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        docpath: "uploads/shared.json",
        createdBy: 7,
      }),
    });
    expect(result.failedToEmbed).toEqual([]);
  });

  it("removes vectors and the tracking record together", async () => {
    mockPrisma.global_documents.findFirst.mockResolvedValue({
      id: 3,
      docId: "doc-3",
      filename: "shared.pdf",
      createdBy: 7,
    });
    mockVectorDb.deleteDocumentFromNamespace.mockResolvedValue(true);
    mockPrisma.$transaction.mockResolvedValue([]);

    await expect(GlobalDocument.delete(3, 7)).resolves.toBe(true);
    expect(mockVectorDb.deleteDocumentFromNamespace).toHaveBeenCalledWith(
      GLOBAL_KNOWLEDGE_NAMESPACE,
      "doc-3"
    );
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([8, null, undefined])("rejects a non-owner %s before touching vectors", async owner => {
    mockPrisma.global_documents.findFirst.mockResolvedValue({ id: 3, createdBy: owner, docId: "doc-3" });
    await expect(GlobalDocument.delete(3, 7)).rejects.toMatchObject({ code: "GLOBAL_DOCUMENT_FORBIDDEN" });
    expect(mockVectorDb.deleteDocumentFromNamespace).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not treat an absent user as an owner in multi-user mode", async () => {
    mockPrisma.global_documents.findFirst.mockResolvedValue({ id: 3, createdBy: null });
    await expect(GlobalDocument.delete(3)).rejects.toMatchObject({ code: "GLOBAL_DOCUMENT_FORBIDDEN" });
  });
});
