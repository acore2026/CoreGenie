/* eslint-env jest, node */
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  modelFilesPresent,
} = require("../../../../utils/EmbeddingEngines/native");

describe("native embedding model cache", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "native-embedder-test-"));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("does not treat a partially downloaded model directory as complete", () => {
    fs.mkdirSync(path.join(root, "onnx"), { recursive: true });
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    fs.writeFileSync(path.join(root, "tokenizer.json"), "x".repeat(100));
    fs.writeFileSync(path.join(root, "tokenizer_config.json"), "{}");

    expect(modelFilesPresent(root)).toBe(false);

    fs.writeFileSync(
      path.join(root, "onnx", "model_quantized.onnx"),
      Buffer.alloc(1024 * 1024)
    );
    expect(modelFilesPresent(root)).toBe(true);
  });
});
