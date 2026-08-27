const mockMilvusClient = jest.fn();

jest.mock("@zilliz/milvus2-sdk-node", () => ({
  DataType: {},
  MetricType: {},
  IndexType: {},
  MilvusClient: mockMilvusClient,
}));

const { Milvus } = require("../../utils/vectorDbProviders/milvus");
const { Zilliz } = require("../../utils/vectorDbProviders/zilliz");

describe.each([
  ["Milvus", Milvus, "milvus"],
  ["Zilliz", Zilliz, "zilliz"],
])("%s connection lifecycle", (name, Connector, vectorDb) => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VECTOR_DB = vectorDb;
    process.env.MILVUS_ADDRESS = "http://milvus.invalid:19530";
    process.env.ZILLIZ_ENDPOINT = "https://zilliz.invalid";
    process.env.ZILLIZ_API_TOKEN = "test-token";
  });

  afterAll(() => {
    delete process.env.VECTOR_DB;
    delete process.env.MILVUS_ADDRESS;
    delete process.env.ZILLIZ_ENDPOINT;
    delete process.env.ZILLIZ_API_TOKEN;
  });

  it("handles the constructor Connect rejection and closes the channel", async () => {
    const closeConnection = jest.fn();
    let rejectConnect;
    const connectPromise = new Promise((resolve, reject) => {
      rejectConnect = reject;
    });
    mockMilvusClient.mockImplementation(() => {
      queueMicrotask(() => rejectConnect(new Error("endpoint unavailable")));
      return {
        connectPromise,
        checkHealth: jest.fn(),
        closeConnection,
      };
    });

    await expect(new Connector().connect()).rejects.toThrow(
      `${name}::Connection failed: endpoint unavailable`
    );
    expect(closeConnection).toHaveBeenCalledTimes(1);
  });

  it("returns a healthy client after the constructor connection completes", async () => {
    const client = {
      connectPromise: Promise.resolve(),
      checkHealth: jest.fn().mockResolvedValue({ isHealthy: true }),
      closeConnection: jest.fn(),
    };
    mockMilvusClient.mockReturnValue(client);

    await expect(new Connector().connect()).resolves.toEqual({ client });
    expect(client.checkHealth).toHaveBeenCalledTimes(1);
    expect(client.closeConnection).not.toHaveBeenCalled();
  });
});
