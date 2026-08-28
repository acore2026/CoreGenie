const fs = require("fs/promises");
const path = require("path");
const { z } = require("zod");
const { defineTool } = require("./descriptor");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");
const { ModelCapability } = require("../models/modelCapability");
const { createChatModel, selectedProvider } = require("../resources/models");
const { contentText, userContent } = require("../agent-system/message");

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

function visionModel(context) {
  return (
    context.run.runtimeSnapshot?.roleModels?.vision ||
    context.run.runtimeSnapshot?.selectedModel ||
    null
  );
}

const inspectImage = defineTool({
  id: "vision.inspect",
  name: "vision_inspect",
  description:
    "Inspect a raster image in the current workspace with the configured vision model. Use it for diagrams, signaling flows, tables, and figures whose relationships cannot be recovered reliably from text alone.",
  action: false,
  effect: "read",
  idempotency: "safe",
  capabilities: ["vision"],
  schema: z.object({
    path: z.string().trim().min(1).max(2_000),
    instructions: z.string().trim().min(1).max(4_000).optional(),
  }),
  activity: ({ path: imagePath }) => `Inspecting visual ${imagePath}`,
  execute: async (
    { path: imagePath, instructions },
    context,
    runnableConfig
  ) => {
    const manager = filesystem.forWorkspace(context.workspace.id);
    const target = await manager.validatePath(imagePath);
    const stats = await fs.stat(target);
    if (!stats.isFile()) throw new Error("Vision input must be a file.");
    if (stats.size > MAX_IMAGE_BYTES)
      throw new Error("Vision input exceeds the 10 MiB limit.");

    const attachment = await manager.readImageAsAttachment(target);
    if (!attachment || !SUPPORTED_IMAGE_TYPES.has(attachment.mime))
      throw new Error(
        "Unsupported image type. Use PNG, JPEG, WEBP, GIF, or BMP."
      );

    await ModelCapability.seedBuiltins();
    const provider = selectedProvider(context.workspace);
    const model = visionModel(context);
    const capability = model
      ? await ModelCapability.get(provider, model)
      : null;
    if (!model || !capability?.vision)
      throw new Error(
        "No explicitly vision-capable model is configured for this Agent."
      );

    const prompt = [
      "Analyze this image as evidence for a 3GPP technical proposal review.",
      "Report only what is visibly supported: visible text, entities, interfaces, arrows/message direction, numbered sequence, and ambiguous or unreadable details.",
      "Never infer a signaling direction when the arrow is not visible.",
      instructions ? `Specific focus: ${instructions}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const response = await createChatModel({
      workspace: context.workspace,
      model,
      temperature: 0,
      thinking: false,
    }).invoke(
      [
        {
          role: "system",
          content:
            "You are a precise multimodal evidence extractor. Return concise Chinese Markdown and include an explicit uncertainty section.",
        },
        { role: "user", content: userContent(prompt, [attachment]) },
      ],
      {
        ...(runnableConfig?.callbacks
          ? { callbacks: runnableConfig.callbacks }
          : {}),
        tags: ["feature:3gpp-review", "role:vision"],
        metadata: {
          role: "vision",
          model,
          sourcePath: path.relative(manager.getAllowedDirectories()[0], target),
          mimeType: attachment.mime,
          byteSize: stats.size,
        },
        runName: "inspect-3gpp-visual",
        signal: context.signal,
      }
    );
    const analysis = contentText(response.content).trim();
    if (!analysis) throw new Error("The vision model returned no analysis.");
    await context.emit("model.routed", {
      role: "vision",
      model,
      capability: "vision",
      sourcePath: imagePath,
    });
    return {
      ok: true,
      code: "VISION_ANALYZED",
      summary: `Inspected ${path.basename(target)} with ${model}.`,
      data: {
        path: imagePath,
        model,
        mimeType: attachment.mime,
        analysis,
      },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

module.exports = { inspectImage, MAX_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES };
