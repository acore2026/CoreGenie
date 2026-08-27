const { runAgentToCompletion } = require("../../agent-system/service");

function formatJSON(
  chat,
  { chunked = false, model, finish_reason = null, usage = {} }
) {
  return {
    id: chat.uuid ?? chat.id,
    object: chunked ? "chat.completion.chunk" : "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [
      {
        index: 0,
        [chunked ? "delta" : "message"]: {
          role: "assistant",
          content: chat.textResponse,
        },
        logprobs: null,
        finish_reason,
      },
    ],
    usage,
  };
}

function runOptions({
  workspace,
  systemPrompt,
  history,
  prompt,
  attachments,
  temperature,
}) {
  return {
    workspace,
    source: "openai-api",
    mode: workspace?.chatMode,
    prompt,
    attachments,
    configuration: {
      history,
      systemPrompt,
      temperature,
      persistChat: true,
      include: true,
      autoTitle: false,
    },
  };
}

async function chatSync(options) {
  const result = await runAgentToCompletion(runOptions(options));
  return formatJSON(
    { id: result.run.id, textResponse: result.textResponse },
    { model: options.workspace.slug, finish_reason: "stop" }
  );
}

async function streamChat(options) {
  const { workspace, response } = options;
  const result = await runAgentToCompletion(runOptions(options), {
    onEvent: async (event) => {
      if (event.type !== "message.delta") return;
      const chunk = formatJSON(
        { id: event.runId, textResponse: event.payload.delta },
        { chunked: true, model: workspace.slug }
      );
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    },
  });
  const finalChunk = formatJSON(
    { id: result.run.id, textResponse: "" },
    { chunked: true, model: workspace.slug, finish_reason: "stop" }
  );
  response.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
  response.write("data: [DONE]\n\n");
}

module.exports.OpenAICompatibleChat = { chatSync, streamChat };
