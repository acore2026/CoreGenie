const fs = require("fs");
const path = require("path");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");

let checkpointerPromise = null;
let customCheckpointerPromise = null;

function checkpointBackend() {
  return String(process.env.LANGGRAPH_CHECKPOINT_BACKEND || "sqlite")
    .trim()
    .toLowerCase();
}

function postgresConnectionString() {
  const connectionString =
    process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "LANGGRAPH_CHECKPOINT_BACKEND=postgresql 时必须设置 DATABASE_URL 或 LANGGRAPH_CHECKPOINT_DATABASE_URL。"
    );
  }
  return connectionString;
}

function postgresSchema(custom = false) {
  const schema = custom
    ? process.env.LANGGRAPH_CUSTOM_CHECKPOINT_SCHEMA || "langgraph_custom"
    : process.env.LANGGRAPH_CHECKPOINT_SCHEMA || "langgraph";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`无效的 LangGraph PostgreSQL schema：${schema}`);
  }
  return schema;
}

function checkpointPath() {
  const storage =
    process.env.STORAGE_DIR || path.resolve(__dirname, "../storage");
  return path.join(storage, "langgraph-checkpoints.db");
}

function customCheckpointPath() {
  const storage =
    process.env.STORAGE_DIR || path.resolve(__dirname, "../storage");
  return path.join(storage, "langgraph-custom-checkpoints.db");
}

async function createCheckpointer(custom = false) {
  const backend = checkpointBackend();
  if (backend === "sqlite") {
    const filepath = custom ? customCheckpointPath() : checkpointPath();
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    return SqliteSaver.fromConnString(filepath);
  }
  if (!["postgres", "postgresql"].includes(backend)) {
    throw new Error(
      `不支持的 LANGGRAPH_CHECKPOINT_BACKEND：${backend}。可用值为 sqlite 或 postgresql。`
    );
  }

  const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
  const saver = PostgresSaver.fromConnString(postgresConnectionString(), {
    schema: postgresSchema(custom),
  });
  await saver.setup();
  return saver;
}

async function getCheckpointer() {
  if (!checkpointerPromise) {
    checkpointerPromise = createCheckpointer(false).catch((error) => {
      checkpointerPromise = null;
      throw error;
    });
  }
  return checkpointerPromise;
}

async function getCustomCheckpointer() {
  if (!customCheckpointerPromise) {
    customCheckpointerPromise = createCheckpointer(true).catch((error) => {
      customCheckpointerPromise = null;
      throw error;
    });
  }
  return customCheckpointerPromise;
}

async function deleteCheckpointThread(threadId) {
  if (!threadId) return;
  const savers = [await getCheckpointer()];
  if (customCheckpointerPromise) {
    savers.push(await getCustomCheckpointer());
  }
  await Promise.allSettled(
    savers.map((saver) => saver.deleteThread(String(threadId)))
  );
}

module.exports = {
  checkpointPath,
  checkpointBackend,
  customCheckpointPath,
  getCheckpointer,
  getCustomCheckpointer,
  deleteCheckpointThread,
  postgresSchema,
};
