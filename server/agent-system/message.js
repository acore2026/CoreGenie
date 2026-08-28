const { safeJsonParse } = require("../utils/http");
const { WORKSPACE_FILE_MIME } = require("./attachments");

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

function isImageAttachment(attachment) {
  return Boolean(
    attachment?.contentString &&
      (String(attachment.mime || "").startsWith("image/") ||
        String(attachment.contentString).startsWith("data:image/"))
  );
}

function userContent(prompt, attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return prompt;
  const workspaceFiles = attachments.filter(
    (attachment) => attachment?.mime === WORKSPACE_FILE_MIME
  );
  const fileContext = workspaceFiles.length
    ? `\n\n<workspace_files>\n${workspaceFiles
        .map(
          (attachment) =>
            `- ${attachment.name || "proposal.docx"}: ${attachment.contentString}`
        )
        .join("\n")}\n</workspace_files>`
    : "";
  const text = `${prompt}${fileContext}`;
  const images = attachments.filter(isImageAttachment);
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.map((attachment) => ({
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
  isImageAttachment,
  finalText,
};
