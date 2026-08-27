/* eslint-env jest, node */
const mockRunAgentToCompletion = jest.fn();

jest.mock("../../../agent-system/service", () => ({
  runAgentToCompletion: (...args) => mockRunAgentToCompletion(...args),
}));

const {
  OpenAICompatibleChat,
} = require("../../../utils/chats/openaiCompatible");

describe("OpenAICompatibleChat", () => {
  const workspace = {
    id: 1,
    slug: "test-workspace",
    chatMode: "chat",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunAgentToCompletion.mockResolvedValue({
      run: { id: "run-1" },
      textResponse: "Mock response",
    });
  });

  it("maps a synchronous OpenAI request to a durable Agent run", async () => {
    const attachments = [
      {
        name: "uploaded_image_0",
        mime: "image/png",
        contentString: "data:image/png;base64,abc123",
      },
    ];
    const result = await OpenAICompatibleChat.chatSync({
      workspace,
      prompt: "What is in this image?",
      attachments,
      systemPrompt: "Be concise",
      history: [{ role: "user", content: "Earlier" }],
      temperature: 0.2,
    });

    expect(mockRunAgentToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        source: "openai-api",
        prompt: "What is in this image?",
        attachments,
        configuration: expect.objectContaining({
          systemPrompt: "Be concise",
          temperature: 0.2,
          persistChat: true,
        }),
      })
    );
    expect(result).toMatchObject({
      id: "run-1",
      object: "chat.completion",
      choices: [
        expect.objectContaining({
          message: { role: "assistant", content: "Mock response" },
          finish_reason: "stop",
        }),
      ],
    });
  });

  it("streams graph deltas in OpenAI-compatible SSE format", async () => {
    mockRunAgentToCompletion.mockImplementation(async (_options, follow) => {
      await follow.onEvent({
        type: "message.delta",
        runId: "run-2",
        payload: { delta: "Hello" },
      });
      return { run: { id: "run-2" }, textResponse: "Hello" };
    });
    const response = { write: jest.fn() };

    await OpenAICompatibleChat.streamChat({
      workspace,
      response,
      prompt: "Hello",
      attachments: [],
      history: [],
    });

    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('"content":"Hello"')
    );
    expect(response.write).toHaveBeenLastCalledWith("data: [DONE]\n\n");
  });
});
