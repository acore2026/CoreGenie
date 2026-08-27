const { ChatOpenAI } = require("@langchain/openai");
const { toValidNumber } = require("../utils/http");
const { GenericOpenAiLLM } = require("../utils/AiProviders/genericOpenAi");

const SUPPORTED_LLM_PROVIDERS = new Set(["openai", "generic-openai"]);

function selectedProvider(workspace = null) {
  const requested = workspace?.agentProvider || workspace?.chatProvider;
  const provider = requested || process.env.LLM_PROVIDER || "openai";
  if (SUPPORTED_LLM_PROVIDERS.has(provider)) return provider;
  throw new Error(
    `LLM provider "${provider}" is unavailable. Configure OpenAI or Generic OpenAI.`
  );
}

function createChatModel({
  workspace = null,
  model = null,
  temperature = null,
  maxTokens = null,
  thinking = true,
} = {}) {
  const provider = selectedProvider(workspace);
  const common = {
    model:
      model ||
      workspace?.agentModel ||
      workspace?.chatModel ||
      (provider === "openai"
        ? process.env.OPEN_MODEL_PREF
        : process.env.GENERIC_OPEN_AI_MODEL_PREF),
    temperature:
      temperature ??
      workspace?.openAiTemp ??
      toValidNumber(process.env.OPEN_AI_TEMPERATURE, 0.7),
    ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
    maxRetries: 2,
  };

  if (provider === "openai") {
    return new ChatOpenAI({
      ...common,
      apiKey: process.env.OPEN_AI_KEY,
    });
  }

  return new ChatOpenAI({
    ...common,
    apiKey: process.env.GENERIC_OPEN_AI_API_KEY || "not-required",
    maxTokens:
      Number(maxTokens) ||
      toValidNumber(process.env.GENERIC_OPEN_AI_MAX_TOKENS, 1024),
    ...(thinking === false
      ? { modelKwargs: { thinking: { type: "disabled" } } }
      : {}),
    configuration: {
      baseURL: process.env.GENERIC_OPEN_AI_BASE_PATH,
      defaultHeaders: GenericOpenAiLLM.parseCustomHeaders(),
    },
  });
}

module.exports = {
  SUPPORTED_LLM_PROVIDERS,
  selectedProvider,
  createChatModel,
};
