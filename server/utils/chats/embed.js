const { EmbedChats } = require("../../models/embedChats");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { runAgentToCompletion } = require("../../agent-system/service");

async function streamChatWithForEmbed(
  response,
  embed,
  message,
  sessionId,
  {
    promptOverride = null,
    modelOverride = null,
    temperatureOverride = null,
    username = null,
  } = {}
) {
  const history = await EmbedChats.forEmbedByUser(
    embed.id,
    sessionId,
    embed.workspace?.openAiHistory || 20,
    { id: "desc" }
  ).then((rows) => rows.reverse());
  const result = await runAgentToCompletion(
    {
      workspace: embed.workspace,
      source: "embed",
      mode: embed.workspace?.chatMode || "chat",
      prompt: message,
      configuration: {
        history,
        systemPrompt: promptOverride,
        model: modelOverride,
        temperature: temperatureOverride,
        persistChat: false,
        autoTitle: false,
      },
    },
    {
      onEvent: async (event) => {
        if (event.type !== "message.delta") return;
        writeResponseChunk(response, {
          uuid: event.runId,
          type: "textResponseChunk",
          textResponse: event.payload.delta,
          sources: [],
          close: false,
          error: false,
        });
      },
    }
  );
  await EmbedChats.new({
    embedId: embed.id,
    prompt: message,
    response: {
      text: result.textResponse,
      type: embed.workspace?.chatMode || "chat",
      sources: result.sources,
      agentRunId: result.run.id,
      metrics: {},
    },
    connection_information: response.locals.connection
      ? {
          ...response.locals.connection,
          username: username ? String(username) : null,
        }
      : { username: username ? String(username) : null },
    sessionId,
  });
  writeResponseChunk(response, {
    uuid: result.run.id,
    type: "finalizeResponseStream",
    close: true,
    error: false,
    metrics: {},
  });
}

module.exports = { streamChatWithForEmbed };
