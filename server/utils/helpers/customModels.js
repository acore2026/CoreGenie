const SUPPORT_CUSTOM_MODELS = ["openai", "generic-openai", "native-embedder"];

async function getCustomModels(provider = "", apiKey = null, basePath = null) {
  if (!SUPPORT_CUSTOM_MODELS.includes(provider))
    return { models: [], error: "Invalid provider for custom models" };

  switch (provider) {
    case "openai":
      return await openAiModels(apiKey);
    case "generic-openai":
      return await getGenericOpenAiModels(basePath, apiKey);
    case "native-embedder":
      return getNativeEmbedderModels();
    default:
      return { models: [], error: "Invalid provider for custom models" };
  }
}

async function openAiModels(apiKey = null) {
  const { OpenAI: OpenAIApi } = require("openai");
  const openai = new OpenAIApi({
    apiKey: apiKey || process.env.OPEN_AI_KEY,
  });
  const allModels = await openai.models
    .list()
    .then((results) => results.data)
    .catch((e) => {
      console.error(`OpenAI:listModels`, e.message);
      return [
        {
          name: "gpt-3.5-turbo",
          id: "gpt-3.5-turbo",
          object: "model",
          created: 1677610602,
          owned_by: "openai",
          organization: "OpenAi",
        },
        {
          name: "gpt-4o",
          id: "gpt-4o",
          object: "model",
          created: 1677610602,
          owned_by: "openai",
          organization: "OpenAi",
        },
        {
          name: "gpt-4",
          id: "gpt-4",
          object: "model",
          created: 1687882411,
          owned_by: "openai",
          organization: "OpenAi",
        },
        {
          name: "gpt-4-turbo",
          id: "gpt-4-turbo",
          object: "model",
          created: 1712361441,
          owned_by: "system",
          organization: "OpenAi",
        },
        {
          name: "gpt-4-32k",
          id: "gpt-4-32k",
          object: "model",
          created: 1687979321,
          owned_by: "openai",
          organization: "OpenAi",
        },
        {
          name: "gpt-3.5-turbo-16k",
          id: "gpt-3.5-turbo-16k",
          object: "model",
          created: 1683758102,
          owned_by: "openai-internal",
          organization: "OpenAi",
        },
      ];
    });

  const gpts = allModels
    .filter(
      (model) =>
        (model.id.includes("gpt") && !model.id.startsWith("ft:")) ||
        model.id.startsWith("o")
    )
    .filter(
      (model) =>
        !model.id.includes("vision") &&
        !model.id.includes("instruct") &&
        !model.id.includes("audio") &&
        !model.id.includes("realtime") &&
        !model.id.includes("image") &&
        !model.id.includes("moderation") &&
        !model.id.includes("transcribe")
    )
    .map((model) => ({
      ...model,
      name: model.id,
      organization: "OpenAi",
    }));

  const customModels = allModels
    .filter(
      (model) =>
        !model.owned_by.includes("openai") && model.owned_by !== "system"
    )
    .map((model) => ({
      ...model,
      name: model.id,
      organization: "Your Fine-Tunes",
    }));

  if ((gpts.length > 0 || customModels.length > 0) && !!apiKey)
    process.env.OPEN_AI_KEY = apiKey;
  return { models: [...gpts, ...customModels], error: null };
}

async function getGenericOpenAiModels(basePath = null, apiKey = null) {
  try {
    const { OpenAI: OpenAIApi } = require("openai");
    const openai = new OpenAIApi({
      baseURL: basePath || process.env.GENERIC_OPEN_AI_BASE_PATH,
      apiKey: apiKey || process.env.GENERIC_OPEN_AI_API_KEY || null,
    });
    const models = await openai.models
      .list()
      .then((results) => results.data)
      .then((models) =>
        models.map((model) => ({
          id: model.id,
          name: model.id,
          organization: model.owned_by ?? "generic-openai",
        }))
      )
      .catch((e) => {
        console.error(`GenericOpenAI:listModels`, e.message);
        return [];
      });

    if (models.length > 0 && !!apiKey)
      process.env.GENERIC_OPEN_AI_API_KEY = apiKey;
    return { models, error: null };
  } catch (e) {
    console.error(`GenericOpenAI:getGenericOpenAiModels`, e.message);
    return { models: [], error: "Could not fetch Generic OpenAI Models" };
  }
}

function getNativeEmbedderModels() {
  const { NativeEmbedder } = require("../EmbeddingEngines/native");
  return { models: NativeEmbedder.availableModels(), error: null };
}

module.exports = {
  getCustomModels,
  SUPPORT_CUSTOM_MODELS,
};
