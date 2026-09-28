/* eslint-env jest, node */
const mockVectorDb = {
  hasNamespace: jest.fn(),
  performSimilaritySearch: jest.fn(),
};
const mockConnector = { embedTextInput: jest.fn() };

jest.mock("../../utils/helpers", () => ({
  getVectorDbClass: () => mockVectorDb,
  resolveProviderConnector: jest.fn(async () => ({ connector: mockConnector })),
}));
jest.mock("../../models/workspaceParsedFiles", () => ({
  WorkspaceParsedFiles: { getContextFiles: jest.fn(async () => []) },
}));

const {
  mergeVectorEntries,
  retrieveSharedVectorContext,
} = require("../../tools/rag");
const { GLOBAL_KNOWLEDGE_NAMESPACE } = require("../../utils/globalKnowledge");

describe("global RAG retrieval", () => {
  beforeEach(() => jest.clearAllMocks());

  it("searches workspace and global namespaces and marks each source", async () => {
    mockVectorDb.hasNamespace.mockResolvedValue(true);
    mockVectorDb.performSimilaritySearch.mockImplementation(
      async ({ namespace }) => ({
        contextTexts: [
          namespace === "alpha" ? "workspace text" : "global text",
        ],
        sources: [{ id: namespace, title: `${namespace} source` }],
        message: null,
      })
    );

    const result = await retrieveSharedVectorContext({
      workspace: {
        slug: "alpha",
        topN: 4,
        similarityThreshold: 0.25,
        vectorSearchMode: "default",
      },
      query: "6G user plane",
    });

    expect(mockVectorDb.performSimilaritySearch).toHaveBeenCalledTimes(2);
    expect(mockVectorDb.performSimilaritySearch).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: GLOBAL_KNOWLEDGE_NAMESPACE })
    );
    expect(result).toEqual([
      expect.objectContaining({
        text: "workspace text",
        source: expect.objectContaining({ ragScope: "workspace" }),
      }),
      expect.objectContaining({
        text: "global text",
        source: expect.objectContaining({ ragScope: "global" }),
      }),
    ]);
  });

  it("returns global results when the workspace has no vectors", async () => {
    mockVectorDb.hasNamespace.mockImplementation(
      async (namespace) => namespace === GLOBAL_KNOWLEDGE_NAMESPACE
    );
    mockVectorDb.performSimilaritySearch.mockResolvedValue({
      contextTexts: ["shared standard"],
      sources: [{ id: "shared" }],
      message: null,
    });

    const result = await retrieveSharedVectorContext({
      workspace: { slug: "empty", topN: 4 },
      query: "standard",
    });

    expect(result).toEqual([
      expect.objectContaining({
        text: "shared standard",
        source: expect.objectContaining({ ragScope: "global" }),
      }),
    ]);
  });

  it("interleaves both scopes, removes duplicates and respects topN", () => {
    const item = (text, scope) => ({
      text,
      source: { id: text, ragScope: scope },
    });
    expect(
      mergeVectorEntries(
        [
          item("w1", "workspace"),
          item("same", "workspace"),
          item("w3", "workspace"),
        ],
        [item("g1", "global"), item("same", "global"), item("g3", "global")],
        4
      ).map(({ text }) => text)
    ).toEqual(["w1", "g1", "same", "w3"]);
  });
});
