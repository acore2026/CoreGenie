/* eslint-env jest, node */
const mockManager = {
  validatePath: jest.fn(),
  readImageAsAttachment: jest.fn(),
  getAllowedDirectories: jest.fn(() => ["/storage/workspace-2"]),
};
const mockImageSize = jest.fn();

jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: {},
}));

jest.mock("fs/promises", () => ({ stat: jest.fn(), readFile: jest.fn() }));
jest.mock("image-size", () => ({ imageSize: mockImageSize }));
jest.mock("../../utils/agents/aibitat/plugins/filesystem/lib", () => ({
  forWorkspace: jest.fn(() => mockManager),
}));
jest.mock("../../models/modelCapability", () => ({
  ModelCapability: {
    seedBuiltins: jest.fn(),
    get: jest.fn(),
  },
}));
jest.mock("../../resources/models", () => ({
  selectedProvider: jest.fn(() => "generic-openai"),
  createChatModel: jest.fn(),
}));

const fs = require("fs/promises");
const { ModelCapability } = require("../../models/modelCapability");
const { createChatModel } = require("../../resources/models");
const { inspectImage } = require("../../tools/vision");

function context() {
  return {
    workspace: { id: 2 },
    run: {
      id: "run-vision",
      runtimeSnapshot: {
        selectedModel: "glm-5.2",
        roleModels: { vision: "qwen3.7-plus" },
      },
    },
    emit: jest.fn(),
    signal: new AbortController().signal,
  };
}

describe("vision.inspect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.validatePath.mockResolvedValue(
      "/storage/workspace-2/figure.png"
    );
    mockManager.readImageAsAttachment.mockResolvedValue({
      name: "figure.png",
      mime: "image/png",
      contentString: "data:image/png;base64,AAAA",
    });
    fs.stat.mockResolvedValue({ isFile: () => true, size: 1024 });
    fs.readFile.mockResolvedValue(Buffer.from("image"));
    mockImageSize.mockReturnValue({ width: 640, height: 480, type: "png" });
    ModelCapability.get.mockResolvedValue({ vision: true });
    createChatModel.mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ content: "实体 A → 实体 B。" }),
    });
  });

  it("uses the configured vision role without exposing image data in metadata", async () => {
    const ctx = context();
    const result = await inspectImage.execute(
      { path: "figure.png", instructions: "识别消息方向" },
      ctx,
      {}
    );

    expect(result).toMatchObject({
      ok: true,
      code: "VISION_ANALYZED",
      data: { model: "qwen3.7-plus", path: "figure.png" },
    });
    const invocation =
      createChatModel.mock.results[0].value.invoke.mock.calls[0];
    expect(JSON.stringify(invocation[1])).not.toContain("base64");
    expect(ctx.emit).toHaveBeenCalledWith(
      "model.routed",
      expect.objectContaining({ role: "vision", model: "qwen3.7-plus" })
    );
  });

  it("rejects a model that is not explicitly vision-capable", async () => {
    ModelCapability.get.mockResolvedValue({ vision: false });
    await expect(
      inspectImage.execute({ path: "figure.png" }, context(), {})
    ).rejects.toThrow("vision-capable");
  });

  it("rejects oversized input before invoking a model", async () => {
    fs.stat.mockResolvedValue({ isFile: () => true, size: 11 * 1024 * 1024 });
    await expect(
      inspectImage.execute({ path: "figure.png" }, context(), {})
    ).rejects.toThrow("10 MiB");
    expect(createChatModel).not.toHaveBeenCalled();
  });

  it("skips an image that is too small without invoking the vision model", async () => {
    mockImageSize.mockReturnValue({ width: 1, height: 1, type: "png" });
    const ctx = context();

    await expect(
      inspectImage.execute({ path: "tracking-pixel.png" }, ctx, {})
    ).resolves.toMatchObject({
      ok: true,
      code: "VISION_SKIPPED_TOO_SMALL",
      data: { width: 1, height: 1 },
    });
    expect(createChatModel).not.toHaveBeenCalled();
    expect(ctx.emit).toHaveBeenCalledWith(
      "vision.skipped",
      expect.objectContaining({
        reason: "image_too_small",
        width: 1,
        height: 1,
      })
    );
  });
});
