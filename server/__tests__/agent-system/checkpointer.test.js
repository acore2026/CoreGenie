jest.mock("@langchain/langgraph-checkpoint-sqlite", () => ({
  SqliteSaver: { fromConnString: jest.fn() },
}));

jest.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: { fromConnString: jest.fn() },
}));

describe("agent checkpointer backends", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    delete process.env.LANGGRAPH_CHECKPOINT_BACKEND;
    delete process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL;
    delete process.env.LANGGRAPH_CHECKPOINT_SCHEMA;
    delete process.env.LANGGRAPH_CUSTOM_CHECKPOINT_SCHEMA;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("uses SQLite unless PostgreSQL is explicitly selected", async () => {
    const saver = { deleteThread: jest.fn() };
    const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
    SqliteSaver.fromConnString.mockReturnValue(saver);
    const { checkpointBackend, getCheckpointer } = require("../../agent-system/checkpointer");

    expect(checkpointBackend()).toBe("sqlite");
    await expect(getCheckpointer()).resolves.toBe(saver);
    expect(SqliteSaver.fromConnString).toHaveBeenCalledTimes(1);
  });

  test("sets up separate PostgreSQL schemas once", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@db:5432/anythingllm";
    process.env.LANGGRAPH_CHECKPOINT_BACKEND = "postgresql";
    const primary = { setup: jest.fn().mockResolvedValue(undefined) };
    const custom = { setup: jest.fn().mockResolvedValue(undefined) };
    const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
    PostgresSaver.fromConnString
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(custom);
    const { getCheckpointer, getCustomCheckpointer } = require("../../agent-system/checkpointer");

    await expect(getCheckpointer()).resolves.toBe(primary);
    await expect(getCheckpointer()).resolves.toBe(primary);
    await expect(getCustomCheckpointer()).resolves.toBe(custom);

    expect(PostgresSaver.fromConnString).toHaveBeenNthCalledWith(
      1,
      process.env.DATABASE_URL,
      { schema: "langgraph" }
    );
    expect(PostgresSaver.fromConnString).toHaveBeenNthCalledWith(
      2,
      process.env.DATABASE_URL,
      { schema: "langgraph_custom" }
    );
    expect(primary.setup).toHaveBeenCalledTimes(1);
    expect(custom.setup).toHaveBeenCalledTimes(1);
  });

  test("rejects PostgreSQL mode without a connection string", async () => {
    process.env.LANGGRAPH_CHECKPOINT_BACKEND = "postgresql";
    const { getCheckpointer } = require("../../agent-system/checkpointer");

    await expect(getCheckpointer()).rejects.toThrow(
      "必须设置 DATABASE_URL 或 LANGGRAPH_CHECKPOINT_DATABASE_URL"
    );
  });
});
