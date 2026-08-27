process.env.NODE_ENV = "test";

const mockVectorDB = {
  performSimilaritySearch: jest.fn(),
  addDocumentToNamespace: jest.fn(),
  deleteDocumentFromNamespace: jest.fn(),
  getDocumentMetadata: jest.fn(),
};
const mockDocumentVectors = {
  where: jest.fn(),
  delete: jest.fn(),
};

jest.mock("../../../../../utils/helpers", () => ({
  getVectorDbClass: () => mockVectorDB,
  resolveProviderConnector: jest.fn(async () => ({ connector: {} })),
}));

jest.mock("../../../../../models/vectors", () => ({
  DocumentVectors: mockDocumentVectors,
}));

const {
  GLOBAL_RAG_MEMORY_NAMESPACE,
  memory,
} = require("../../../../../utils/agents/aibitat/plugins/memory");

function createTool(workspace = { slug: "alpha", topN: 4 }) {
  let tool = null;
  const aibitat = {
    handlerProps: {
      invocation: { workspace },
      log: jest.fn(),
    },
    function: jest.fn((definition) => {
      tool = definition;
    }),
    addCitation: jest.fn(),
    addContextTrace: jest.fn(),
    introspect: jest.fn(),
  };
  memory.plugin().setup(aibitat);
  return { aibitat, tool };
}

async function invoke(tool, payload) {
  return tool.handler.call(tool, payload);
}

describe("rag-memory agent plugin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVectorDB.addDocumentToNamespace.mockResolvedValue({
      vectorized: true,
      error: null,
    });
    mockVectorDB.deleteDocumentFromNamespace.mockResolvedValue(true);
    mockVectorDB.getDocumentMetadata.mockResolvedValue([]);
    mockDocumentVectors.where.mockResolvedValue([
      { id: 1, docId: "stored-doc", vectorId: "v1" },
    ]);
    mockDocumentVectors.delete.mockResolvedValue(true);
  });

  it("adds explicit memoryId to legacy Agent memory results and merges chunks", async () => {
    mockVectorDB.performSimilaritySearch.mockImplementation(({ namespace }) => {
      if (namespace !== "alpha")
        return Promise.resolve({ contextTexts: [], sources: [] });
      return Promise.resolve({
        contextTexts: ["First chunk", "Second chunk"],
        sources: [
          {
            id: "legacy-v1",
            title: "agent-memory.txt",
            url: "file://embed-via-agent.txt",
            docAuthor: "@agent",
          },
          {
            id: "legacy-v2",
            title: "agent-memory.txt",
            url: "file://embed-via-agent.txt",
            docAuthor: "@agent",
          },
        ],
      });
    });
    mockDocumentVectors.where.mockImplementation(({ vectorId }) =>
      Promise.resolve([
        {
          docId: "00000000-0000-0000-0000-000000000007",
          vectorId,
        },
      ])
    );
    const { aibitat, tool } = createTool();

    const response = await invoke(tool, {
      action: "search",
      content: "legacy memory",
    });

    expect(response).toContain(
      "memoryId: workspace/alpha/00000000-0000-0000-0000-000000000007"
    );
    expect(response).toContain("deletable: true");
    expect(response.match(/\[RAG MEMORY\]/g)).toHaveLength(1);
    expect(response).toContain("First chunk\n\nSecond chunk");
    expect(aibitat.addContextTrace).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 })
    );
  });

  it("searches workspace and global namespaces transparently", async () => {
    mockVectorDB.performSimilaritySearch.mockImplementation(({ namespace }) => {
      if (namespace === "alpha")
        return Promise.resolve({
          contextTexts: ["Workspace fact"],
          sources: [{ title: "workspace.txt" }],
        });
      return Promise.resolve({
        contextTexts: ["Global fact"],
        sources: [
          {
            title: "global-agent-memory.txt",
            memoryType: "rag-memory",
            memoryId: "global/00000000-0000-0000-0000-000000000001",
          },
        ],
      });
    });
    const { aibitat, tool } = createTool();

    const response = await invoke(tool, {
      action: "search",
      content: "facts",
    });

    expect(mockVectorDB.performSimilaritySearch).toHaveBeenCalledTimes(2);
    expect(mockVectorDB.performSimilaritySearch).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "alpha", input: "facts" })
    );
    expect(mockVectorDB.performSimilaritySearch).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: GLOBAL_RAG_MEMORY_NAMESPACE,
        input: "facts",
      })
    );
    expect(response).toContain("Workspace fact");
    expect(response).toContain("Global fact");
    expect(aibitat.addCitation).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ ragScope: "workspace" }),
        expect.objectContaining({ ragScope: "global" }),
      ])
    );
    expect(aibitat.addContextTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "memory",
        count: 2,
        scopes: ["workspace", "global"],
      })
    );
  });

  it("stores in workspace scope by default with a deletable memory ID", async () => {
    const { tool } = createTool();
    const response = await invoke(tool, {
      action: "store",
      content: "Workspace memory",
    });

    expect(mockVectorDB.addDocumentToNamespace).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({
        docId: expect.stringMatching(/^workspace\/alpha\//),
        memoryId: expect.stringMatching(/^workspace\/alpha\//),
        memoryScope: "workspace",
        pageContent: "Workspace memory",
      }),
      null
    );
    const stored = mockVectorDB.addDocumentToNamespace.mock.calls[0][1];
    expect(stored.id).toBe(stored.docId);
    expect(stored.memoryId).toBe(stored.docId);
    expect(response).toContain(stored.memoryId);
  });

  it("accepts 全局 as an explicit global store scope", async () => {
    const { tool } = createTool();
    await invoke(tool, {
      action: "store",
      scope: "全局",
      content: "Global memory",
    });

    expect(mockVectorDB.addDocumentToNamespace).toHaveBeenCalledWith(
      GLOBAL_RAG_MEMORY_NAMESPACE,
      expect.objectContaining({
        docId: expect.stringMatching(/^global\//),
        memoryScope: "global",
      }),
      null
    );
  });

  it("deletes only from the namespace encoded in memoryId", async () => {
    const { tool } = createTool();
    const memoryId = "global/00000000-0000-0000-0000-000000000001";
    const response = await invoke(tool, {
      action: "delete",
      memoryId,
      scope: "global",
    });

    expect(mockDocumentVectors.where).toHaveBeenCalledWith({ docId: memoryId });
    expect(mockVectorDB.deleteDocumentFromNamespace).toHaveBeenCalledWith(
      GLOBAL_RAG_MEMORY_NAMESPACE,
      memoryId
    );
    expect(mockDocumentVectors.delete).toHaveBeenCalledWith({ docId: memoryId });
    expect(response).toContain("Deleted global RAG memory");
  });

  it("rejects workspace memory IDs owned by another workspace", async () => {
    const { tool } = createTool();
    const response = await invoke(tool, {
      action: "delete",
      memoryId:
        "workspace/another/00000000-0000-0000-0000-000000000001",
    });

    expect(response).toContain("belongs to another workspace");
    expect(mockVectorDB.deleteDocumentFromNamespace).not.toHaveBeenCalled();
  });

  it("deletes a legacy Agent memory using the memoryId returned by search", async () => {
    const legacyDocId = "00000000-0000-0000-0000-000000000007";
    mockDocumentVectors.where.mockImplementation(({ docId }) => {
      if (docId === legacyDocId)
        return Promise.resolve([{ docId, vectorId: "legacy-v1" }]);
      return Promise.resolve([]);
    });
    mockVectorDB.getDocumentMetadata.mockResolvedValue([
      {
        title: "agent-memory.txt",
        url: "file://embed-via-agent.txt",
        docAuthor: "@agent",
      },
    ]);
    const { tool } = createTool();
    const memoryId = `workspace/alpha/${legacyDocId}`;

    const response = await invoke(tool, { action: "delete", memoryId });

    expect(mockVectorDB.getDocumentMetadata).toHaveBeenCalledWith(
      "alpha",
      legacyDocId
    );
    expect(mockVectorDB.deleteDocumentFromNamespace).toHaveBeenCalledWith(
      "alpha",
      legacyDocId
    );
    expect(mockDocumentVectors.delete).toHaveBeenCalledWith({
      docId: legacyDocId,
    });
    expect(response).toContain("Deleted workspace RAG memory");
  });
});
