const { contentText, isAssistantMessage } = require("../message");

async function consumeGraphStream(
  graphRun,
  onToken,
  { visibleNodes = null, onTurnStart = null } = {}
) {
  let finalState = null;
  let currentTurnKey = null;
  let turnNumber = 0;
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
    const node = metadata.langgraph_node || metadata.langgraphNode || "model";
    const step = metadata.langgraph_step ?? metadata.langgraphStep;
    const turnKey =
      step !== undefined && step !== null
        ? `${node}:${step}`
        : message?.id
          ? `${node}:${message.id}`
          : currentTurnKey || `${node}:1`;
    if (turnKey !== currentTurnKey) {
      currentTurnKey = turnKey;
      turnNumber += 1;
      await onTurnStart?.({ turnId: `turn-${turnNumber}` });
    }
    const token = contentText(message?.content);
    if (token) await onToken(token, { turnId: `turn-${turnNumber}` });
  }
  return finalState;
}

module.exports = { consumeGraphStream };
