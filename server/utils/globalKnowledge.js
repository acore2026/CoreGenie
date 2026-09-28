const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const GLOBAL_KNOWLEDGE_NAMESPACE = "anythingllm-global-knowledge";
const TEXT_DOWNLOAD_EXTENSIONS = new Set([
  ".csv",
  ".html",
  ".json",
  ".md",
  ".txt",
  ".xml",
]);

function sourceRoot() {
  return process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../storage/global-knowledge")
    : path.resolve(process.env.STORAGE_DIR, "global-knowledge");
}

function sourcePath(storageName, root = sourceRoot()) {
  if (!storageName || path.basename(storageName) !== storageName) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, storageName);
  return resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : null;
}

async function preserveGlobalKnowledgeSource(
  uploadedPath,
  originalName,
  root = sourceRoot()
) {
  const safeOriginalName = path.basename(String(originalName || "document"));
  const extension = path.extname(safeOriginalName).slice(0, 20);
  const storageName = `${uuidv4()}${extension}`;
  const destination = sourcePath(storageName, root);
  await fs.mkdir(root, { recursive: true });
  await fs.copyFile(uploadedPath, destination);
  return { storageName, originalName: safeOriginalName };
}

async function removeGlobalKnowledgeSource(storageName, root = sourceRoot()) {
  const target = sourcePath(storageName, root);
  if (!target) return false;
  await fs.unlink(target).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  return true;
}

function fallbackDownloadName(title) {
  const safeTitle = path.basename(String(title || "document"));
  const extension = path.extname(safeTitle).toLowerCase();
  if (TEXT_DOWNLOAD_EXTENSIONS.has(extension)) return safeTitle;
  const base = path.basename(safeTitle, extension) || "document";
  return `${base}.txt`;
}

async function getGlobalKnowledgeDownload(
  document,
  { root = sourceRoot(), readDocument } = {}
) {
  let metadata = {};
  try {
    metadata = JSON.parse(document?.metadata || "{}");
  } catch {}

  const storedSource = sourcePath(metadata.sourceFile?.storageName, root);
  if (storedSource) {
    try {
      await fs.access(storedSource);
      return {
        kind: "file",
        path: storedSource,
        filename:
          path.basename(metadata.sourceFile?.originalName || "") ||
          fallbackDownloadName(metadata.title || document.filename),
      };
    } catch {}
  }

  const loadDocument = readDocument || require("./files").fileData;
  const parsed = await loadDocument(document?.docpath);
  if (typeof parsed?.pageContent !== "string") return null;
  return {
    kind: "text",
    content: parsed.pageContent,
    filename: fallbackDownloadName(metadata.title || document.filename),
  };
}

module.exports = {
  GLOBAL_KNOWLEDGE_NAMESPACE,
  fallbackDownloadName,
  getGlobalKnowledgeDownload,
  preserveGlobalKnowledgeSource,
  removeGlobalKnowledgeSource,
  sourcePath,
};
