const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { GlobalDocument } = require("../models/globalDocuments");
const { CollectorApi } = require("../utils/collectorApi");
const { directUploadsPath, documentsPath } = require("../utils/files");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");

const MAX_GLOBAL_INGEST_FILES = 20;
const MAX_GLOBAL_SOURCE_BYTES = 100 * 1024 * 1024;

function safeSegment(value, fallback = "document") {
  const clean = String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return clean || fallback;
}

async function removeParsedUpload(document) {
  const location = String(document?.location || "");
  if (!location) return;
  const target = path.join(directUploadsPath, path.basename(location));
  await fs.rm(target, { force: true }).catch(() => null);
}

function publicDocument(document) {
  let metadata = {};
  try {
    metadata = JSON.parse(document.metadata || "{}");
  } catch {}
  return {
    id: document.id,
    title: metadata.title || document.filename,
    filename: document.filename,
    createdAt: document.createdAt,
  };
}

async function prepareGlobalSource(sourcePath, context, manager, collector) {
  const target = await manager.validatePath(sourcePath);
  const stats = await fs.lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error("Global knowledge only accepts regular Workspace files.");
  if (stats.size === 0) throw new Error("The source file is empty.");
  if (stats.size > MAX_GLOBAL_SOURCE_BYTES)
    throw new Error("The source file exceeds the 100 MiB ingestion limit.");

  const contentHash = crypto
    .createHash("sha256")
    .update(await fs.readFile(target))
    .digest("hex");
  const root = manager.getAllowedDirectories()[0];
  const relativeSource = path.relative(root, target).split(path.sep).join("/");
  const parsed = await collector.parseDocument(path.basename(target), {
    absolutePath: target,
  });
  if (!parsed?.success || !parsed.documents?.length)
    throw new Error(parsed?.reason || "The document could not be parsed.");

  const documentPaths = [];
  try {
    for (const [index, parsedDocument] of parsed.documents.entries()) {
      const suffix = parsed.documents.length > 1 ? `-${index + 1}` : "";
      const docPath = path
        .join(
          "global-rag-ingest",
          `${contentHash.slice(0, 24)}-${safeSegment(path.basename(target))}${suffix}.json`
        )
        .split(path.sep)
        .join("/");
      documentPaths.push(docPath);
      if (await GlobalDocument.get({ docpath: docPath })) continue;

      const absoluteDocPath = path.join(documentsPath, docPath);
      const documentData = {
        ...parsedDocument,
        id: parsedDocument.id || uuidv4(),
        name: path.basename(target),
        title: parsedDocument.title || path.basename(target),
        url: `global://${contentHash.slice(0, 24)}/${encodeURIComponent(path.basename(target))}`,
        chunkSource: `global://${contentHash.slice(0, 24)}/${encodeURIComponent(path.basename(target))}`,
        docAuthor:
          context.user?.username || context.agent?.name || "CoreGenie user",
        description: `Shared global knowledge from ${relativeSource}.`,
        docSource: "global-knowledge-tool",
        ragScope: "global",
        ragSourceSha256: contentHash,
      };
      delete documentData.location;
      delete documentData.isDirectUpload;
      await fs.mkdir(path.dirname(absoluteDocPath), { recursive: true });
      const temporary = `${absoluteDocPath}.${uuidv4()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(documentData), "utf8");
      await fs.rename(temporary, absoluteDocPath);
    }
  } finally {
    await Promise.all(parsed.documents.map(removeParsedUpload));
  }

  return { sourcePath: relativeSource, contentHash, documentPaths };
}

async function ingestPaths(paths, context) {
  const manager = filesystem.forWorkspace(context.workspace.id);
  const collector = new CollectorApi();
  if (!(await collector.online()))
    return {
      ok: false,
      code: "DOCUMENT_PROCESSOR_UNAVAILABLE",
      summary:
        "The document processor is unavailable. Nothing was added to global knowledge.",
      data: { ingested: [], failed: paths },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };

  const prepared = [];
  const failed = [];
  for (const sourcePath of [...new Set(paths)]) {
    try {
      prepared.push(
        await prepareGlobalSource(sourcePath, context, manager, collector)
      );
    } catch (error) {
      failed.push({ sourcePath, error: String(error?.message || error) });
    }
  }

  const documentPaths = prepared.flatMap((item) => item.documentPaths);
  const result = documentPaths.length
    ? await GlobalDocument.addDocuments(documentPaths, context.user?.id || null)
    : { embedded: [], failedToEmbed: [], errors: [] };
  const records = await Promise.all(
    result.embedded.map((docpath) => GlobalDocument.get({ docpath }))
  );
  for (const docpath of result.failedToEmbed) {
    failed.push({
      sourcePath: docpath,
      error: result.errors[0] || "Embedding failed.",
    });
  }

  const added = records.filter(Boolean).map(publicDocument);
  const ok = added.length > 0;
  await context.emit("global_knowledge.ingested", {
    workspaceId: context.workspace.id,
    added: added.length,
    failed: failed.length,
  });
  return {
    ok,
    code: failed.length
      ? ok
        ? "GLOBAL_KNOWLEDGE_PARTIAL"
        : "GLOBAL_KNOWLEDGE_FAILED"
      : "GLOBAL_KNOWLEDGE_INGESTED",
    summary: ok
      ? `Added ${added.length} document(s) to global knowledge${failed.length ? `; ${failed.length} failed` : ""}.`
      : `No documents were added to global knowledge; ${failed.length} failed.`,
    data: { documents: added, failed },
    evidenceIds: [],
    artifactIds: [],
    retryable: false,
  };
}

const listGlobalKnowledge = defineTool({
  id: "knowledge.global.list",
  name: "knowledge_global_list",
  description:
    "List documents in the shared global RAG knowledge base. These documents are searchable from every Workspace.",
  action: false,
  effect: "read",
  idempotency: "safe",
  schema: z.object({}),
  activity: "Listing shared global knowledge",
  execute: async (_args, context) => {
    const documents = (await GlobalDocument.all()).map(publicDocument);
    await context.emit("global_knowledge.listed", { count: documents.length });
    return {
      ok: true,
      code: "GLOBAL_KNOWLEDGE_LISTED",
      summary: `Global knowledge contains ${documents.length} document(s).`,
      data: { documents },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

const ingestGlobalKnowledge = defineTool({
  id: "knowledge.global.ingest",
  name: "knowledge_global_ingest",
  description:
    "Add regular files from the current authenticated Workspace filesystem to shared global RAG. Every Workspace can retrieve the result. Use only when the user explicitly asks to share the files globally; never infer global publication from an ordinary upload or report request.",
  action: true,
  effect: "write",
  idempotency: "keyed",
  concurrencyKey: "global-knowledge",
  failureScope: "Global knowledge ingestion",
  schema: z.object({
    paths: z
      .array(z.string().trim().min(1).max(2_000))
      .min(1)
      .max(MAX_GLOBAL_INGEST_FILES),
  }),
  activity: ({ paths }) =>
    `Adding ${paths.length} document${paths.length === 1 ? "" : "s"} to shared global knowledge`,
  execute: async ({ paths }, context) => ingestPaths(paths, context),
});

const removeGlobalKnowledge = defineTool({
  id: "knowledge.global.remove",
  name: "knowledge_global_remove",
  description:
    "Remove one document from shared global RAG by its numeric ID. This affects retrieval in every Workspace. Use only when the user explicitly asks to remove that global document; call knowledge.global.list first when the ID is unknown.",
  action: true,
  effect: "destructive",
  idempotency: "none",
  concurrencyKey: "global-knowledge",
  schema: z.object({ id: z.number().int().positive() }),
  activity: ({ id }) => `Removing global knowledge document ${id}`,
  execute: async ({ id }, context) => {
    const document = await GlobalDocument.get({ id });
    if (!document)
      return {
        ok: false,
        code: "GLOBAL_DOCUMENT_NOT_FOUND",
        summary: `Global knowledge document ${id} was not found.`,
        data: { id },
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };
    await GlobalDocument.delete(id, context.user?.id || null);
    await context.emit("global_knowledge.removed", {
      documentId: id,
      workspaceId: context.workspace.id,
    });
    return {
      ok: true,
      code: "GLOBAL_DOCUMENT_REMOVED",
      summary: `Removed ${publicDocument(document).title} from global knowledge.`,
      data: { document: publicDocument(document) },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

const replaceGlobalKnowledge = defineTool({
  id: "knowledge.global.replace",
  name: "knowledge_global_replace",
  description:
    "Replace one shared global RAG document with a regular file from the current authenticated Workspace filesystem. The new file is embedded before the old document is removed. This affects every Workspace and must only be used when the user explicitly requests the replacement.",
  action: true,
  effect: "destructive",
  idempotency: "keyed",
  concurrencyKey: "global-knowledge",
  schema: z.object({
    id: z.number().int().positive(),
    path: z.string().trim().min(1).max(2_000),
  }),
  activity: ({ id, path: sourcePath }) =>
    `Replacing global knowledge document ${id} with ${sourcePath}`,
  execute: async ({ id, path: sourcePath }, context) => {
    const previous = await GlobalDocument.get({ id });
    if (!previous)
      return {
        ok: false,
        code: "GLOBAL_DOCUMENT_NOT_FOUND",
        summary: `Global knowledge document ${id} was not found.`,
        data: { id },
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };

    const ingested = await ingestPaths([sourcePath], context);
    if (!ingested.ok) return ingested;
    const replacements = ingested.data.documents;
    if (replacements.some((document) => document.id === previous.id)) {
      return {
        ...ingested,
        code: "GLOBAL_DOCUMENT_UNCHANGED",
        summary: "The selected file is already the current global document.",
      };
    }

    await GlobalDocument.delete(previous.id, context.user?.id || null);
    await context.emit("global_knowledge.replaced", {
      previousDocumentId: previous.id,
      replacementDocumentIds: replacements.map((document) => document.id),
      workspaceId: context.workspace.id,
    });
    return {
      ok: true,
      code: "GLOBAL_DOCUMENT_REPLACED",
      summary: `Replaced ${publicDocument(previous).title} with ${replacements.length} global document(s).`,
      data: {
        previous: publicDocument(previous),
        replacements,
      },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

module.exports = {
  listGlobalKnowledge,
  ingestGlobalKnowledge,
  removeGlobalKnowledge,
  replaceGlobalKnowledge,
  prepareGlobalSource,
  ingestPaths,
  publicDocument,
  MAX_GLOBAL_INGEST_FILES,
  MAX_GLOBAL_SOURCE_BYTES,
};
