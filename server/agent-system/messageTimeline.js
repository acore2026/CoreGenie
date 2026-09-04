const TEXT_PART = "text";
const TOOL_GROUP_PART = "toolGroup";

function cloneParts(parts = []) {
  return parts
    .filter((part) => part && [TEXT_PART, TOOL_GROUP_PART].includes(part.type))
    .map((part) =>
      part.type === TEXT_PART
        ? {
            id: String(part.id),
            type: TEXT_PART,
            text: String(part.text || ""),
          }
        : {
            id: String(part.id),
            type: TOOL_GROUP_PART,
            callIds: [...new Set((part.callIds || []).map(String))],
          }
    );
}

function ensureTextPart(parts, partId) {
  const id = String(partId);
  let part = parts.find((item) => item.id === id && item.type === TEXT_PART);
  if (!part) {
    part = { id, type: TEXT_PART, text: "" };
    parts.push(part);
  }
  return part;
}

function appendText(parts, partId, delta) {
  if (!delta) return parts;
  ensureTextPart(parts, partId).text += String(delta);
  return parts;
}

function ensureToolGroup(parts, groupId) {
  const id = String(groupId);
  let part = parts.find(
    (item) => item.id === id && item.type === TOOL_GROUP_PART
  );
  if (!part) {
    part = { id, type: TOOL_GROUP_PART, callIds: [] };
    parts.push(part);
  }
  return part;
}

function appendToolCall(parts, groupId, callId) {
  if (!callId) return parts;
  const part = ensureToolGroup(parts, groupId);
  const id = String(callId);
  if (!part.callIds.includes(id)) part.callIds.push(id);
  return parts;
}

function paragraphSeparator(text = "") {
  if (!text) return "";
  if (text.endsWith("\n\n")) return "";
  if (text.endsWith("\n")) return "\n";
  return "\n\n";
}

function plainTextFromParts(parts = []) {
  return parts
    .filter((part) => part.type === TEXT_PART && String(part.text || "").length)
    .map((part) => String(part.text))
    .reduce(
      (text, partText) => `${text}${paragraphSeparator(text)}${partText}`,
      ""
    );
}

function partsFromEvents(events = [], messageId = null) {
  let parts = [];
  for (const event of events) {
    const payload = event?.payload || {};
    if (messageId && payload.messageId && payload.messageId !== messageId)
      continue;
    if (event?.type === "message.completed" && Array.isArray(payload.parts)) {
      parts = cloneParts(payload.parts);
      continue;
    }
    if (event?.type === "message.delta" && payload.partId) {
      appendText(parts, payload.partId, payload.partDelta ?? payload.delta);
      continue;
    }
    if (event?.type?.startsWith("tool.") && payload.groupId && payload.callId)
      appendToolCall(parts, payload.groupId, payload.callId);
  }
  return parts;
}

module.exports = {
  TEXT_PART,
  TOOL_GROUP_PART,
  appendText,
  appendToolCall,
  cloneParts,
  paragraphSeparator,
  partsFromEvents,
  plainTextFromParts,
};
