const fs = require("fs");
const path = require("path");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");

let checkpointer = null;
let customCheckpointer = null;

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

function getCheckpointer() {
  if (checkpointer) return checkpointer;
  const filepath = checkpointPath();
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  checkpointer = SqliteSaver.fromConnString(filepath);
  return checkpointer;
}

function getCustomCheckpointer() {
  if (customCheckpointer) return customCheckpointer;
  const filepath = customCheckpointPath();
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  customCheckpointer = SqliteSaver.fromConnString(filepath);
  return customCheckpointer;
}

module.exports = {
  checkpointPath,
  customCheckpointPath,
  getCheckpointer,
  getCustomCheckpointer,
};
