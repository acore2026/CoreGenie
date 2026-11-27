const { EncryptionManager } = require("../EncryptionManager");

let cachedCollector = null;
function loadCollector() {
  if (!cachedCollector) {
    cachedCollector = require("@coregenie/collector");
  }
  return cachedCollector;
}

class CollectorApi {
  log(text, ...args) {
    console.log(`\x1b[36m[CollectorApi]\x1b[0m ${text}`, ...args);
  }

  #attachOptions() {
    return {
      ocr: {
        langList: process.env.TARGET_OCR_LANG || "eng",
      },
      runtimeSettings: {
        allowAnyIp: process.env.COLLECTOR_ALLOW_ANY_IP ?? "false",
      },
    };
  }

  async online() {
    try {
      loadCollector();
      return true;
    } catch {
      return false;
    }
  }

  async acceptedFileTypes() {
    try {
      return loadCollector().ACCEPTED_MIMES;
    } catch (e) {
      this.log(e.message);
      return null;
    }
  }

  async processDocument(filename = "", metadata = {}) {
    if (!filename) return false;
    return loadCollector().processDocument({
      filename,
      metadata,
      options: this.#attachOptions(),
    });
  }

  async processLink(link = "", scraperHeaders = {}, metadata = {}) {
    if (!link) return false;
    return loadCollector().processLink({
      link,
      scraperHeaders,
      options: this.#attachOptions(),
      metadata,
    });
  }

  async processRawText(textContent = "", metadata = {}) {
    return loadCollector().processRawText({
      textContent,
      metadata,
      options: this.#attachOptions(),
    });
  }

  async forwardExtensionRequest({ endpoint, body }) {
    return loadCollector().handleExtension({
      endpoint,
      body,
      encryptionKeyBase64: new EncryptionManager().xPayload,
    });
  }

  async getLinkContent(link = "", captureAs = "text") {
    if (!link) return false;
    return loadCollector().getLinkContent({
      link,
      captureAs,
      options: this.#attachOptions(),
    });
  }

  async parseDocument(filename = "", parseOptions = {}) {
    if (!filename) return false;
    return loadCollector().parseDocument({
      filename,
      options: {
        ...this.#attachOptions(),
        absolutePath: parseOptions.absolutePath || null,
      },
    });
  }
}

module.exports.CollectorApi = CollectorApi;
