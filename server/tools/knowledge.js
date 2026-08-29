const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { Document } = require("../models/documents");
const { AgentReportPublication } = require("../models/agentReportPublication");
const { CollectorApi } = require("../utils/collectorApi");
const { directUploadsPath, documentsPath } = require("../utils/files");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");
const {
  LLMPerformanceMonitor,
} = require("../utils/helpers/chat/LLMPerformanceMonitor");

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_INGEST_FILES = 50;
const MAX_INGEST_SOURCE_BYTES = 100 * 1024 * 1024;
const MANIFEST_SCHEMA = "3gpp-review-manifest/v1";
const COVERAGE_SCHEMA = "3gpp-review-coverage/v1";

function documentIds(items) {
  return [...new Set(items.map((item) => String(item).toUpperCase()))].sort();
}

function coverageFailure(code, summary, data = {}) {
  return {
    ok: false,
    code,
    summary,
    data,
    evidenceIds: [],
    artifactIds: [],
    retryable: false,
  };
}

async function validateCoverageBinding(args, context, manager) {
  const required = Boolean(
    context.run?.runtimeSnapshot?.runtimeConfig?.publicationRequiresCoverage
  );
  if (!required && !args.manifestPath && !args.coverageReceiptPath)
    return { ok: true, metadata: null };
  if (!args.manifestPath || !args.coverageReceiptPath)
    return coverageFailure(
      "COVERAGE_BINDING_REQUIRED",
      "Publication requires both the exact filter-index manifest path and the successful coverage receipt path."
    );

  let manifestTarget;
  let receiptTarget;
  try {
    [manifestTarget, receiptTarget] = await Promise.all([
      manager.validatePath(args.manifestPath),
      manager.validatePath(args.coverageReceiptPath),
    ]);
    const [manifestRaw, receiptRaw] = await Promise.all([
      fs.readFile(manifestTarget, "utf8"),
      fs.readFile(receiptTarget, "utf8"),
    ]);
    const manifest = JSON.parse(manifestRaw);
    const receipt = JSON.parse(receiptRaw);
    if (
      manifest?.schema !== MANIFEST_SCHEMA ||
      !Array.isArray(manifest?.proposals) ||
      manifest.count !== manifest.proposals.length
    )
      return coverageFailure(
        "INVALID_PROPOSAL_MANIFEST",
        "The proposal manifest is not a valid filter-index manifest. Regenerate it with the Skill helper."
      );
    const manifestIds = documentIds(
      manifest.proposals.map((item) => item?.document || "")
    );
    if (
      manifestIds.length !== manifest.proposals.length ||
      manifestIds.some((item) => !/^[A-Z]\d-\d{6,8}$/.test(item))
    )
      return coverageFailure(
        "INVALID_PROPOSAL_MANIFEST",
        "The proposal manifest contains an invalid or duplicate TDoc number."
      );
    const suppliedIds = documentIds(args.tdocIds || []);
    if (JSON.stringify(suppliedIds) !== JSON.stringify(manifestIds))
      return coverageFailure(
        "TDOC_SET_MISMATCH",
        "The publication TDoc list must exactly match the validated proposal manifest.",
        { expected: manifestIds, supplied: suppliedIds }
      );
    const manifestHash = crypto
      .createHash("sha256")
      .update(manifestRaw)
      .digest("hex");
    const expected = documentIds(receipt?.expectedDocuments || []);
    const extracted = documentIds(receipt?.extractedDocuments || []);
    if (
      receipt?.schema !== COVERAGE_SCHEMA ||
      receipt?.status !== "passed" ||
      receipt?.manifestSha256 !== manifestHash ||
      !Array.isArray(receipt?.missing) ||
      receipt.missing.length ||
      !Array.isArray(receipt?.extra) ||
      receipt.extra.length ||
      JSON.stringify(expected) !== JSON.stringify(manifestIds) ||
      JSON.stringify(extracted) !== JSON.stringify(manifestIds)
    )
      return coverageFailure(
        "INVALID_COVERAGE_RECEIPT",
        "The coverage receipt does not prove exact coverage for the current proposal manifest. Rerun coverage and use the new receipt."
      );
    return {
      ok: true,
      metadata: {
        manifestPath: args.manifestPath,
        coverageReceiptPath: args.coverageReceiptPath,
        manifestSha256: manifestHash,
        validatedAt: receipt.validatedAt || null,
      },
    };
  } catch (error) {
    return coverageFailure(
      "COVERAGE_BINDING_UNREADABLE",
      "The manifest or coverage receipt could not be read and validated.",
      { cause: String(error?.message || error) }
    );
  }
}

function embeddingUnavailableResult(error) {
  const message = String(error?.message || error || "");
  if (
    message !== "fetch failed" &&
    !message.includes("local_files_only=true") &&
    !message.includes("allowRemoteModels=false")
  )
    return null;
  return {
    ok: false,
    code: "EMBEDDING_MODEL_UNAVAILABLE",
    summary:
      "The content was preserved, but it could not be added to the Workspace RAG knowledge base because the configured embedding model is unavailable. Retry in a new run after the model cache or network is repaired.",
    data: { cause: message },
    evidenceIds: [],
    artifactIds: [],
    retryable: false,
    blocksCapability: true,
  };
}

function safeSegment(value, fallback = "report") {
  const clean = String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return clean || fallback;
}

function publicationOutput(publication, workspace, sourceStats) {
  return {
    type: "workspaceFile",
    payload: {
      workspaceSlug: workspace.slug,
      path: publication.sourcePath,
      filename: path.basename(publication.sourcePath),
      fileSize: sourceStats.size,
      publicationId: publication.id,
    },
  };
}

async function removeParsedUpload(document) {
  const location = String(document?.location || "");
  if (!location) return;
  const target = path.join(directUploadsPath, path.basename(location));
  await fs.rm(target, { force: true }).catch(() => null);
}

async function ingestSource(sourcePath, context, manager, collector) {
  const target = await manager.validatePath(sourcePath);
  const stats = await fs.lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error("RAG ingestion only accepts regular workspace files.");
  if (stats.size === 0) throw new Error("The source file is empty.");
  if (stats.size > MAX_INGEST_SOURCE_BYTES)
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

  const folder = path.join(
    "rag-ingest",
    safeSegment(context.workspace.slug, `workspace-${context.workspace.id}`)
  );
  const documentPaths = [];
  try {
    for (const [index, parsedDocument] of parsed.documents.entries()) {
      const suffix = parsed.documents.length > 1 ? `-${index + 1}` : "";
      const docPath = path
        .join(
          folder,
          `${contentHash.slice(0, 24)}-${safeSegment(path.basename(target), "document")}${suffix}.json`
        )
        .split(path.sep)
        .join("/");
      documentPaths.push(docPath);
      const existing = await Document.get({
        workspaceId: context.workspace.id,
        docpath: docPath,
      });
      if (existing) continue;

      const absoluteDocPath = path.join(documentsPath, docPath);
      const documentData = {
        ...parsedDocument,
        id: parsedDocument.id || uuidv4(),
        name: path.basename(target),
        title: parsedDocument.title || path.basename(target),
        url: `workspace://${context.workspace.slug}/${relativeSource}`,
        chunkSource: `workspace://${context.workspace.slug}/${relativeSource}`,
        docAuthor: context.agent?.name || "CoreGenie Agent",
        description: `Workspace document ingested into the RAG knowledge base from ${relativeSource}.`,
        docSource: "workspace-rag-ingest",
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

  const pendingPaths = [];
  const alreadyEmbedded = [];
  for (const docPath of documentPaths) {
    const existing = await Document.get({
      workspaceId: context.workspace.id,
      docpath: docPath,
    });
    if (existing) alreadyEmbedded.push(docPath);
    else pendingPaths.push(docPath);
  }
  if (pendingPaths.length) {
    const result = await Document.addDocuments(
      context.workspace,
      pendingPaths,
      context.user?.id || null
    );
    if (
      result.failedToEmbed?.length ||
      result.embedded?.length !== pendingPaths.length
    )
      throw new Error(result.errors?.[0] || "Failed to embed the document.");
  }
  return {
    sourcePath: relativeSource,
    sha256: contentHash,
    documentPaths,
    status: pendingPaths.length ? "ingested" : "already_ingested",
  };
}

const ingestDocuments = defineTool({
  id: "knowledge.ingest",
  name: "knowledge_ingest",
  description:
    "Add regular document files from the authenticated Workspace filesystem to this Workspace RAG knowledge base. The files are parsed, chunked, embedded, and become searchable through knowledge.search for retrieval-augmented generation (RAG). This is not personal memory. Extract ZIP archives before calling this tool.",
  action: true,
  effect: "write",
  idempotency: "keyed",
  concurrencyKey: "knowledge-ingest",
  failureScope: "RAG knowledge ingestion",
  schema: z.object({
    paths: z
      .array(z.string().trim().min(1).max(2_000))
      .min(1)
      .max(MAX_INGEST_FILES),
  }),
  activity: ({ paths }) =>
    `Adding ${paths.length} document${paths.length === 1 ? "" : "s"} to Workspace RAG`,
  execute: async ({ paths }, context) => {
    const manager = filesystem.forWorkspace(context.workspace.id);
    const collector = new CollectorApi();
    if (!(await collector.online()))
      return {
        ok: false,
        code: "DOCUMENT_PROCESSOR_UNAVAILABLE",
        summary:
          "The document processor is unavailable, so the files were not added to the Workspace RAG knowledge base.",
        data: { ingested: [], failed: paths },
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };

    const results = [];
    const failed = [];
    const uniquePaths = [...new Set(paths)];
    for (const sourcePath of uniquePaths) {
      try {
        results.push(
          await ingestSource(sourcePath, context, manager, collector)
        );
      } catch (error) {
        const unavailable = embeddingUnavailableResult(error);
        if (unavailable) return unavailable;
        failed.push({
          sourcePath,
          error: String(error?.message || error),
        });
      }
    }

    const ingested = results.filter((item) => item.status === "ingested");
    const existing = results.filter(
      (item) => item.status === "already_ingested"
    );
    const ok = results.length > 0;
    const code = failed.length
      ? ok
        ? "RAG_INGEST_PARTIAL"
        : "RAG_INGEST_FAILED"
      : existing.length === results.length
        ? "RAG_DOCUMENTS_ALREADY_INGESTED"
        : "RAG_DOCUMENTS_INGESTED";
    const summary = ok
      ? `Added ${ingested.length} document source(s) to Workspace RAG; ${existing.length} were already present${failed.length ? `; ${failed.length} failed` : ""}.`
      : `No documents were added to Workspace RAG; ${failed.length} failed.`;
    await context.emit("knowledge.ingested", {
      workspaceId: context.workspace.id,
      ingested: ingested.length,
      alreadyIngested: existing.length,
      failed: failed.length,
    });
    return {
      ok,
      code,
      summary,
      data: { results, failed },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

const publishReport = defineTool({
  id: "knowledge.publish",
  name: "knowledge_publish",
  description:
    "Publish one final Markdown report into this Workspace RAG knowledge base. The report is embedded and becomes searchable through knowledge.search for retrieval-augmented generation (RAG). Call exactly once after coverage and report validation are complete; this is not personal memory or general document ingestion.",
  action: true,
  effect: "write",
  idempotency: "keyed",
  concurrencyKey: "knowledge-publish",
  failureScope: "Knowledge publication",
  schema: z.object({
    path: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(2_000).optional(),
    meeting: z.string().trim().max(120).optional(),
    ki: z.string().trim().max(120).optional(),
    tdocIds: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Za-z]\d-\d{6,8}$/)
      )
      .max(500)
      .default([]),
    manifestPath: z.string().trim().min(1).max(2_000).optional(),
    coverageReceiptPath: z.string().trim().min(1).max(2_000).optional(),
  }),
  activity: ({ path: reportPath }) => `Publishing ${reportPath}`,
  execute: async (args, context) => {
    const manager = filesystem.forWorkspace(context.workspace.id);
    const target = await manager.validatePath(args.path);
    if (path.extname(target).toLowerCase() !== ".md")
      throw new Error("Only Markdown reports can be published.");
    const stats = await fs.stat(target);
    if (!stats.isFile()) throw new Error("Report path must be a file.");
    if (stats.size === 0) throw new Error("The report is empty.");
    if (stats.size > MAX_REPORT_BYTES)
      throw new Error("The report exceeds the 5 MiB publication limit.");
    const content = await fs.readFile(target, "utf8");
    if (!content.trim()) throw new Error("The report is empty.");

    const coverage = await validateCoverageBinding(args, context, manager);
    if (!coverage.ok) return coverage;

    const root = manager.getAllowedDirectories()[0];
    const sourcePath = path.relative(root, target).split(path.sep).join("/");
    const contentHash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
    const existing = await AgentReportPublication.get(
      context.run.id,
      sourcePath
    );
    if (existing?.status === "published") {
      if (existing.contentHash !== contentHash)
        return {
          ok: false,
          code: "PUBLISHED_REPORT_CHANGED",
          summary:
            "This report path was already published with different content. Save the revision under a new versioned filename.",
          retryable: false,
        };
      return {
        ok: true,
        code: "ALREADY_PUBLISHED",
        summary: `Report already published as ${existing.title}.`,
        data: {
          publication: existing,
          output: publicationOutput(existing, context.workspace, stats),
        },
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };
    }
    if (existing && existing.contentHash !== contentHash)
      return {
        ok: false,
        code: "PUBLICATION_CONTENT_CHANGED",
        summary:
          "A previous publication attempt exists for this path with different content. Use a new versioned filename.",
        retryable: false,
      };

    const runPublications = await AgentReportPublication.forRun(
      context.run.id,
      { publishedOnly: false }
    );
    const competing = runPublications.find(
      (item) =>
        item.sourcePath !== sourcePath &&
        ["publishing", "published"].includes(item.status)
    );
    if (competing)
      return {
        ok: false,
        code:
          competing.status === "published"
            ? "RUN_REPORT_ALREADY_PUBLISHED"
            : "RUN_REPORT_PUBLICATION_IN_PROGRESS",
        summary:
          competing.status === "published"
            ? `This run already published its canonical final report at ${competing.sourcePath}. Do not publish another report path.`
            : `This run is already publishing its canonical final report at ${competing.sourcePath}.`,
        data: { publication: competing },
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };

    const publicationId = existing?.id || uuidv4();
    const metadata = {
      meeting: args.meeting || null,
      ki: args.ki || null,
      tdocIds: [...new Set(args.tdocIds.map((item) => item.toUpperCase()))],
      runId: context.run.id,
      agentId: context.agent?.id || null,
      contentHash,
      coverage: coverage.metadata,
    };
    let publication = await AgentReportPublication.begin({
      id: publicationId,
      runId: context.run.id,
      workspaceId: context.workspace.id,
      sourcePath,
      contentHash,
      title: args.title,
      metadata,
    });

    const folder = path.join(
      "agent-reports",
      safeSegment(context.workspace.slug, `workspace-${context.workspace.id}`),
      safeSegment(context.run.id)
    );
    const docPath = path
      .join(folder, `${safeSegment(path.basename(sourcePath, ".md"))}.json`)
      .split(path.sep)
      .join("/");
    const absoluteDocPath = path.join(documentsPath, docPath);
    const documentData = {
      name: path.basename(sourcePath),
      type: "file",
      url: `workspace://${context.workspace.slug}/${sourcePath}`,
      title: args.title,
      docAuthor: context.agent?.name || "AnythingLLM Agent",
      description:
        args.description || "Agent-generated 3GPP proposal analysis report.",
      docSource: "agent-report",
      chunkSource: `workspace://${context.workspace.slug}/${sourcePath}`,
      published: new Date().toISOString(),
      wordCount: content.trim().split(/\s+/u).length,
      token_count_estimate: LLMPerformanceMonitor.countTokens([{ content }]),
      pageContent: content,
      // Vector stores such as LanceDB flatten every top-level document field
      // into an Arrow column. Keep structured publication metadata as JSON so
      // it remains portable across vector backends instead of creating an
      // unsupported nested-object column.
      agentPublication: JSON.stringify(metadata),
    };

    try {
      await fs.mkdir(path.dirname(absoluteDocPath), { recursive: true });
      const temporary = `${absoluteDocPath}.${uuidv4()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(documentData), "utf8");
      await fs.rename(temporary, absoluteDocPath);

      let document = await Document.get({
        workspaceId: context.workspace.id,
        docpath: docPath,
      });
      if (!document) {
        const result = await Document.addDocuments(
          context.workspace,
          [docPath],
          context.user?.id || null
        );
        if (result.failedToEmbed?.length || !result.embedded?.includes(docPath))
          throw new Error(result.errors?.[0] || "Failed to embed the report.");
        document = await Document.get({
          workspaceId: context.workspace.id,
          docpath: docPath,
        });
      }
      if (!document)
        throw new Error("Published document record was not found.");
      publication = await AgentReportPublication.complete(publicationId, {
        documentId: document.id,
        documentPath: docPath,
      });
      await context.emit("knowledge.published", {
        publicationId,
        workspaceId: context.workspace.id,
        sourcePath,
        documentId: document.id,
        meeting: args.meeting || null,
        ki: args.ki || null,
        tdocCount: metadata.tdocIds.length,
      });
      return {
        ok: true,
        code: "REPORT_PUBLISHED",
        summary: `Published ${args.title} to the ${context.workspace.name} knowledge base.`,
        data: {
          publication,
          output: publicationOutput(publication, context.workspace, stats),
        },
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };
    } catch (error) {
      await AgentReportPublication.fail(publicationId, error.message).catch(
        () => null
      );
      const unavailable = embeddingUnavailableResult(error);
      if (unavailable) return unavailable;
      throw error;
    }
  },
});

module.exports = {
  ingestDocuments,
  publishReport,
  publicationOutput,
  embeddingUnavailableResult,
  validateCoverageBinding,
  MAX_REPORT_BYTES,
  MAX_INGEST_FILES,
  MAX_INGEST_SOURCE_BYTES,
};
