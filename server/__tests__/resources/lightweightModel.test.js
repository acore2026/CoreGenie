jest.mock("@langchain/openai", () => ({
  ChatOpenAICompletions: class {},
  ChatOpenAI: jest.fn().mockImplementation((options) => ({ options })),
}));
jest.mock("../../models/systemSettings", () => ({
  SystemSettings: { getValueOrFallback: jest.fn() },
}));
jest.mock("../../utils/AiProviders/genericOpenAi", () => ({
  GenericOpenAiLLM: { parseCustomHeaders: () => ({}) },
}));
const { ChatOpenAI } = require("@langchain/openai");
const { SystemSettings } = require("../../models/systemSettings");
const {
  createChatModel,
  createLightweightChatModel,
} = require("../../resources/models");
beforeEach(() => {
  jest.clearAllMocks();
  SystemSettings.getValueOrFallback.mockImplementation(async ({ label }) =>
    label.endsWith("provider") ? "generic-openai" : "fast-model"
  );
});
it("uses the designated provider and model for explicitly lightweight work", async () => {
  await createLightweightChatModel({
    workspace: { agentProvider: "openai", agentModel: "large-model" },
    maxTokens: 64,
  });
  expect(ChatOpenAI).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "fast-model",
      maxTokens: 64,
      temperature: 0,
      modelKwargs: { thinking: { type: "disabled" } },
    })
  );
});
it("leaves the main model untouched", () => {
  createChatModel({
    workspace: { agentProvider: "openai", agentModel: "large-model" },
  });
  expect(ChatOpenAI).toHaveBeenCalledWith(
    expect.objectContaining({ model: "large-model" })
  );
  expect(SystemSettings.getValueOrFallback).not.toHaveBeenCalled();
});
it("inherits the conversation model when configuration is empty", async () => {
  SystemSettings.getValueOrFallback.mockResolvedValue("");
  await createLightweightChatModel({
    workspace: { agentProvider: "openai", agentModel: "current-model" },
  });
  expect(ChatOpenAI).toHaveBeenCalledWith(
    expect.objectContaining({ model: "current-model" })
  );
});
it("does not combine an incomplete selection with the wrong provider", async () => {
  SystemSettings.getValueOrFallback.mockImplementation(async ({ label }) =>
    label.endsWith("provider") ? "generic-openai" : ""
  );
  await createLightweightChatModel({
    workspace: { agentProvider: "openai", agentModel: "current-model" },
  });
  expect(ChatOpenAI).toHaveBeenCalledWith(
    expect.objectContaining({ model: "current-model" })
  );
});
