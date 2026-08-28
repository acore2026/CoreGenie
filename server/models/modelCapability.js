const prisma = require("../utils/prisma");

const BUILTIN_CAPABILITIES = [
  {
    provider: "openai",
    model: "gpt-4o",
    vision: true,
    toolCalling: true,
    structuredOutput: true,
    reasoningControls: false,
    contextWindow: 128_000,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    vision: true,
    toolCalling: true,
    structuredOutput: true,
    reasoningControls: false,
    contextWindow: 128_000,
  },
  {
    provider: "generic-openai",
    model: "qwen3.7-plus",
    vision: true,
    toolCalling: true,
    structuredOutput: false,
    reasoningControls: true,
    contextWindow: 131_072,
  },
];

const ModelCapability = {
  seedBuiltins: async function () {
    for (const item of BUILTIN_CAPABILITIES) {
      await prisma.model_capabilities.upsert({
        where: {
          provider_model: { provider: item.provider, model: item.model },
        },
        create: { ...item, source: "builtin" },
        update: {},
      });
    }
  },

  get: async function (provider, model) {
    return prisma.model_capabilities.findUnique({
      where: {
        provider_model: { provider: String(provider), model: String(model) },
      },
    });
  },

  list: async function (provider = null) {
    return prisma.model_capabilities.findMany({
      where: provider ? { provider: String(provider) } : undefined,
      orderBy: [{ provider: "asc" }, { model: "asc" }],
    });
  },

  upsert: async function (input, updatedBy = null) {
    const key = {
      provider: String(input.provider),
      model: String(input.model),
    };
    const data = {
      vision: Boolean(input.vision),
      toolCalling: Boolean(input.toolCalling),
      structuredOutput: Boolean(input.structuredOutput),
      reasoningControls: Boolean(input.reasoningControls),
      contextWindow: input.contextWindow ? Number(input.contextWindow) : null,
      source: input.source === "builtin" ? "builtin" : "admin",
      updatedBy: updatedBy ? Number(updatedBy) : null,
      lastUpdatedAt: new Date(),
    };
    return prisma.model_capabilities.upsert({
      where: { provider_model: key },
      create: { ...key, ...data },
      update: data,
    });
  },
};

module.exports = { BUILTIN_CAPABILITIES, ModelCapability };
