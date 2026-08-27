const { createMiddleware } = require("langchain");
const { contentText } = require("./message");

function reasoningText(message) {
  return String(
    message?.additional_kwargs?.reasoning_content ||
      message?.response_metadata?.reasoning_content ||
      ""
  );
}

function isReasoningOnly(message) {
  if (!message || message.tool_calls?.length) return false;
  return !contentText(message.content).trim() && reasoningText(message).trim();
}

/**
 * Some OpenAI-compatible reasoning models can consume their entire output
 * budget in `reasoning_content` and return an empty visible answer. Retry only
 * that model call with thinking disabled, before LangGraph commits the empty
 * message or executes any tools.
 */
function reasoningOnlyFallbackMiddleware(createFallbackModel) {
  return createMiddleware({
    name: "ReasoningOnlyFallback",
    wrapModelCall: async (request, handler) => {
      const response = await handler(request);
      if (!isReasoningOnly(response)) return response;
      return handler({ ...request, model: createFallbackModel() });
    },
  });
}

module.exports = {
  isReasoningOnly,
  reasoningOnlyFallbackMiddleware,
  reasoningText,
};
