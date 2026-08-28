const { safeJsonParse } = require("../utils/http");

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentText).join("");
  if (!content || typeof content !== "object") return "";
  if (typeof content.text === "string") return content.text;
  if (typeof content.output_text === "string") return content.output_text;
  if (
    ["text", "text_delta", "output_text"].includes(content.type) &&
    typeof content.content === "string"
  )
    return content.content;
  return "";
}

function messageRole(message) {
  return message?.getType?.() || message?.type || message?.role || "";
}

function isAssistantMessage(message) {
  return ["ai", "assistant"].includes(messageRole(message));
}

function persistedHistory(rows = []) {
  const messages = [];
  for (const row of rows) {
    messages.push({ role: "user", content: row.prompt });
    const response = safeJsonParse(row.response, {});
    if (response?.text)
      messages.push({ role: "assistant", content: response.text });
  }
  return messages;
}

function normalizedHistory(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry) return [];
    if (Object.hasOwn(entry, "prompt") && Object.hasOwn(entry, "response"))
      return persistedHistory([entry]);
    const role = entry.role || entry.type;
    if (!["user", "assistant", "system"].includes(role)) return [];
    return [{ role, content: entry.content || "" }];
  });
}

function userContent(prompt, attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return prompt;
  return [
    { type: "text", text: prompt },
    ...attachments
      .filter((attachment) => attachment?.contentString)
      .map((attachment) => ({
        type: "image_url",
        image_url: { url: attachment.contentString, detail: "high" },
      })),
  ];
}

function finalText(state) {
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistantMessage(message)) {
      const text = contentText(message.content);
      if (text) return text;
    }
  }
  return "";
}

module.exports = {
  contentText,
  isAssistantMessage,
  messageRole,
  persistedHistory,
  normalizedHistory,
  userContent,
  finalText,
};
