import type { CollectorOptions, DocumentMetadata, RepoArgs } from "./types.js";
import path from "node:path";
import { ACCEPTED_MIMES } from "./utils/constants.js";
import { processSingleFile } from "./processSingleFile/index.js";
import { processLink, getLinkText } from "./processLink/index.js";
import { processRawText } from "./processRawText/index.js";
import { wipeCollectorStorage } from "./utils/files/index.js";
import runtimeSettings from "./utils/runtimeSettings/index.js";
import { EncryptionWorker } from "./utils/EncryptionWorker/index.js";
import { loadGithubRepo } from "./utils/extensions/RepoLoader/GithubRepo/index.js";
import RepoLoader from "./utils/extensions/RepoLoader/GithubRepo/RepoLoader/index.js";
import { resyncLink, resyncGithub } from "./extensions/resync/index.js";

interface ExtensionBody extends RepoArgs {
  type?: string;
  options?: CollectorOptions & { link?: string; chunkSource?: string };
}

function normalizeFilename(filename = "") {
  return path.normalize(String(filename)).replace(/^(\.\.(\/|\\|$))+/, "");
}

function applyRuntimeSettings(options: CollectorOptions = {}) {
  runtimeSettings.applyOptions(options?.runtimeSettings);
}

async function processDocument({
  filename = "",
  options = {},
  metadata = {},
}: {
  filename?: string;
  options?: CollectorOptions;
  metadata?: DocumentMetadata;
}) {
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
      reason:
        (e instanceof Error ? e.message : String(e)) ||
        "A processing error occurred.",
      documents: [],
    };
  }
}

async function parseDocument({
  filename = "",
  options = {},
}: {
  filename?: string;
  options?: CollectorOptions;
}) {
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
      reason:
        (e instanceof Error ? e.message : String(e)) ||
        "A processing error occurred.",
      documents: [],
    };
  }
}

async function processLinkDocument({
  link = "",
  scraperHeaders = {},
  options = {},
  metadata = {},
}: {
  link?: string;
  scraperHeaders?: Record<string, string>;
  options?: CollectorOptions;
  metadata?: DocumentMetadata;
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
      reason:
        (e instanceof Error ? e.message : String(e)) ||
        "A processing error occurred.",
      documents: [],
    };
  }
}

async function getLinkContent({
  link = "",
  captureAs = "text",
  options = {},
}: {
  link?: string;
  captureAs?: string;
  options?: CollectorOptions;
}) {
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
}: {
  textContent?: string;
  metadata?: DocumentMetadata;
  options?: CollectorOptions;
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
      reason:
        (e instanceof Error ? e.message : String(e)) ||
        "A processing error occurred.",
      documents: [],
    };
  }
}

async function handleExtension({
  endpoint,
  body = {},
  encryptionKeyBase64 = "",
}: {
  endpoint: string;
  body?: string | ExtensionBody;
  encryptionKeyBase64?: string;
}) {
  const payload: ExtensionBody =
    typeof body === "string" ? JSON.parse(body) : body || {};
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
        if (type === "link") return await resyncLink(options ?? {});
        if (type === "github")
          return await resyncGithub(options ?? {}, responseContext);
        throw new Error(`Type "${type}" is not a valid type to sync.`);
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
      reason:
        (e instanceof Error ? e.message : String(e)) ||
        "A processing error occurred.",
    };
  }
}

export {
  ACCEPTED_MIMES,
  wipeCollectorStorage,
  processDocument,
  parseDocument,
  processLinkDocument as processLink,
  getLinkContent,
  processRawTextDocument as processRawText,
  handleExtension,
};
