const path = require("path");
const { ACCEPTED_MIMES } = require("./utils/constants");
const { processSingleFile } = require("./processSingleFile");
const { processLink, getLinkText } = require("./processLink");
const { processRawText } = require("./processRawText");
const { wipeCollectorStorage } = require("./utils/files");
const RuntimeSettings = require("./utils/runtimeSettings");
const { EncryptionWorker } = require("./utils/EncryptionWorker");
const { loadGithubRepo } = require("./utils/extensions/RepoLoader/GithubRepo");
const RepoLoader = require("./utils/extensions/RepoLoader/GithubRepo/RepoLoader");
const RESYNC_METHODS = require("./extensions/resync");

function normalizeFilename(filename = "") {
  return path.normalize(String(filename)).replace(/^(\.\.(\/|\\|$))+/, "");
}

function applyRuntimeSettings(options = {}) {
  new RuntimeSettings().applyOptions(options?.runtimeSettings);
}

async function processDocument({ filename = "", options = {}, metadata = {} }) {
  applyRuntimeSettings(options);
  try {
    const targetFilename = normalizeFilename(filename);
    const {
      success,
      reason,
      documents = [],
    } = await processSingleFile(targetFilename, options, metadata);
    return { filename: targetFilename, success, reason, documents };
  } catch (e) {
    console.error(e);
    return {
      filename,
      success: false,
      reason: e?.message || "A processing error occurred.",
      documents: [],
    };
  }
}

async function parseDocument({ filename = "", options = {} }) {
  applyRuntimeSettings(options);
  try {
    const targetFilename = normalizeFilename(filename);
    const {
      success,
      reason,
      documents = [],
    } = await processSingleFile(targetFilename, {
      ...options,
      parseOnly: true,
      absolutePath: options.absolutePath || null,
    });
    return { filename: targetFilename, success, reason, documents };
  } catch (e) {
    console.error(e);
    return {
      filename,
      success: false,
      reason: e?.message || "A processing error occurred.",
      documents: [],
    };
  }
}

async function processLinkDocument({
  link = "",
  scraperHeaders = {},
  options = {},
  metadata = {},
}) {
  applyRuntimeSettings(options);
  try {
    const {
      success,
      reason,
      documents = [],
    } = await processLink(link, scraperHeaders, metadata);
    return { url: link, success, reason, documents };
  } catch (e) {
    console.error(e);
    return {
      url: link,
      success: false,
      reason: e?.message || "A processing error occurred.",
      documents: [],
    };
  }
}

async function getLinkContent({ link = "", captureAs = "text", options = {} }) {
  applyRuntimeSettings(options);
  try {
    const { success, content = null } = await getLinkText(link, captureAs);
    return { url: link, success, content };
  } catch (e) {
    console.error(e);
    return { url: link, success: false, content: null };
  }
}

async function processRawTextDocument({
  textContent = "",
  metadata = {},
  options = {},
}) {
  applyRuntimeSettings(options);
  try {
    const {
      success,
      reason,
      documents = [],
    } = await processRawText(textContent, metadata);
    return {
      filename: metadata.title || "Unknown-doc.txt",
      success,
      reason,
      documents,
    };
  } catch (e) {
    console.error(e);
    return {
      filename: "unknown",
      success: false,
      reason: e?.message || "A processing error occurred.",
      documents: [],
    };
  }
}

async function handleExtension({
  endpoint,
  body = {},
  encryptionKeyBase64 = "",
}) {
  const payload = typeof body === "string" ? JSON.parse(body) : body || {};
  applyRuntimeSettings(payload?.options);
  const responseContext = {
    locals: {
      encryptionWorker: new EncryptionWorker(encryptionKeyBase64),
    },
  };

  try {
    switch (endpoint) {
      case "/ext/resync-source-document": {
        const { type, options } = payload;
        if (!Object.prototype.hasOwnProperty.call(RESYNC_METHODS, type)) {
          throw new Error(`Type "${type}" is not a valid type to sync.`);
        }
        return await RESYNC_METHODS[type](options, responseContext);
      }
      case "/ext/github-repo": {
        const { success, reason, data } = await loadGithubRepo(
          payload,
          responseContext
        );
        return { success, reason, data };
      }
      case "/ext/github-repo/branches": {
        const branches = await new RepoLoader(payload).getRepoBranches();
        return { success: true, reason: null, data: { branches } };
      }
      default:
        return {
          success: false,
          reason: `Unknown collector extension endpoint: ${endpoint}`,
          data: {},
        };
    }
  } catch (e) {
    console.error(e);
    return {
      success: false,
      content: null,
      data: {},
      reason: e?.message || "A processing error occurred.",
    };
  }
}

module.exports = {
  ACCEPTED_MIMES,
  wipeCollectorStorage,
  processDocument,
  parseDocument,
  processLink: processLinkDocument,
  getLinkContent,
  processRawText: processRawTextDocument,
  handleExtension,
};
