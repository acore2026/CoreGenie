const { ChatOpenAICompletions } = require("@langchain/openai");

// Some compatible endpoints omit the initial assistant role in streamed deltas.
// Normalize before conversion: converting a generic chunk afterward would lose
// tool-call fragments and reasoning metadata that the SDK already discarded.
class CompatibleChatCompletions extends ChatOpenAICompletions {
  _convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole) {
    return super._convertCompletionsDeltaToBaseMessageChunk(
      delta,
      rawResponse,
      defaultRole ?? "assistant"
    );
  }
}

module.exports = { CompatibleChatCompletions };
