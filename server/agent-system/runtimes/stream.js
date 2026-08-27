const { contentText, isAssistantMessage } = require("../message");

async function consumeGraphStream(
  graphRun,
  onToken,
  { visibleNodes = null } = {}
) {
  let finalState = null;
  for await (const [mode, data] of graphRun) {
    if (mode === "values") {
      finalState = data;
      continue;
    }
    if (mode !== "messages") continue;
    const [message, metadata = {}] = data;
    if (!isAssistantMessage(message)) continue;
    if (
      visibleNodes &&
      !visibleNodes.has(metadata.langgraph_node || metadata.langgraphNode)
    )
      continue;
    const token = contentText(message?.content);
    if (token) await onToken(token);
  }
  return finalState;
}

module.exports = { consumeGraphStream };
