const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { CollectorApi } = require("../collectorApi");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { grepAllSlashCommands } = require("./index");
const {
  hotdirPath,
  normalizePath,
  isWithin,
  sanitizeFileName,
} = require("../files");
const { runAgentToCompletion } = require("../../agent-system/service");

async function processDocumentAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0)
    return { parsedDocuments: [], imageAttachments: [] };
  const documentAttachments = [];
  const imageAttachments = [];
  for (const attachment of attachments) {
    if (
      attachment?.contentString &&
      attachment?.mime?.toLowerCase() === "application/anythingllm-document"
    )
      documentAttachments.push(attachment);
    else imageAttachments.push(attachment);
  }
  if (documentAttachments.length === 0)
    return { parsedDocuments: [], imageAttachments };

  const collector = new CollectorApi();
  if (!(await collector.online()))
    return { parsedDocuments: [], imageAttachments };
  if (!fs.existsSync(hotdirPath)) fs.mkdirSync(hotdirPath, { recursive: true });

  const parsedDocuments = [];
  for (const attachment of documentAttachments) {
    try {
      const match = attachment.contentString.match(/^data:[^;]+;base64,(.+)$/);
      const buffer = Buffer.from(
        match?.[1] || attachment.contentString,
        "base64"
      );
      const filename = sanitizeFileName(
        normalizePath(attachment.name || `attachment-${uuidv4()}`)
      );
      const filePath = normalizePath(path.join(hotdirPath, filename));
      if (!isWithin(hotdirPath, filePath))
        throw new Error(`Invalid attachment path: ${filename}`);
      fs.writeFileSync(filePath, buffer);
      const parsed = await collector.parseDocument(filename);
      if (parsed.success && parsed.documents?.length)
        parsedDocuments.push(...parsed.documents);
    } catch (error) {
      console.error(`Failed to parse attachment: ${error.message}`);
    }
  }
  return { parsedDocuments, imageAttachments };
}

async function prepareNativeRequest(message, attachments) {
  const processedMessage = await grepAllSlashCommands(message);
  const { parsedDocuments, imageAttachments } =
    await processDocumentAttachments(attachments);
  const documents = parsedDocuments
    .map((document, index) =>
      document?.pageContent
        ? `<attachment index="${index + 1}">\n${document.pageContent}\n</attachment>`
        : null
    )
    .filter(Boolean)
    .join("\n");
  return {
    prompt: documents
      ? `${processedMessage}\n\n<attachment_context>\n${documents}\n</attachment_context>`
      : processedMessage,
    attachments: imageAttachments,
  };
}

async function resetHistory({ workspace, user, thread, sessionId, message }) {
  await WorkspaceChats.markThreadHistoryInvalidV2({
    workspaceId: workspace.id,
    user_id: user?.id,
    thread_id: thread?.id,
    api_session_id: sessionId,
  });
  return !message?.length;
}

function resetResponse() {
  return {
    id: uuidv4(),
    type: "textResponse",
    textResponse: "Chat history was reset!",
    sources: [],
    close: true,
    error: null,
    metrics: {},
  };
}

async function chatSync(options) {
  const {
    workspace,
    user = null,
    thread = null,
    sessionId = null,
    reset = false,
  } = options;
  if (reset && (await resetHistory({ ...options, user, thread, sessionId })))
    return resetResponse();
  const request = await prepareNativeRequest(
    options.message,
    options.attachments || []
  );
  const result = await runAgentToCompletion({
    workspace,
    thread,
    user,
    source: "api",
    mode: options.mode,
    prompt: request.prompt,
    attachments: request.attachments,
    configuration: {
      apiSessionId: sessionId,
      include: true,
      autoTitle: false,
    },
  });
  return {
    id: result.run.id,
    type: "textResponse",
    textResponse: result.textResponse,
    sources: result.sources,
    close: true,
    error: null,
    metrics: {},
    chatId: result.chatId,
  };
}

async function streamChat(options) {
  const {
    response,
    workspace,
    user = null,
    thread = null,
    sessionId = null,
    reset = false,
  } = options;
  if (reset && (await resetHistory({ ...options, user, thread, sessionId }))) {
    writeResponseChunk(response, resetResponse());
    return;
  }
  const request = await prepareNativeRequest(
    options.message,
    options.attachments || []
  );
  const result = await runAgentToCompletion(
    {
      workspace,
      thread,
      user,
      source: "api",
      mode: options.mode,
      prompt: request.prompt,
      attachments: request.attachments,
      configuration: {
        apiSessionId: sessionId,
        include: true,
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
  writeResponseChunk(response, {
    uuid: result.run.id,
    type: "finalizeResponseStream",
    close: true,
    error: false,
    chatId: result.chatId,
    metrics: {},
    sources: result.sources,
  });
}

module.exports.ApiChatHandler = { chatSync, streamChat };
