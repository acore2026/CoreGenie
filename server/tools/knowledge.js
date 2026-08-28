const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { Document } = require("../models/documents");
const { AgentReportPublication } = require("../models/agentReportPublication");
const { documentsPath } = require("../utils/files");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");
const {
  LLMPerformanceMonitor,
} = require("../utils/helpers/chat/LLMPerformanceMonitor");

const MAX_REPORT_BYTES = 5 * 1024 * 1024;

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

const publishReport = defineTool({
  id: "knowledge.publish",
  name: "knowledge_publish",
  description:
    "Publish a final Markdown report from the current workspace into this Workspace knowledge base. Call exactly once after coverage and report validation are complete.",
  action: true,
  effect: "write",
  idempotency: "keyed",
  concurrencyKey: "knowledge-publish",
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

    const publicationId = existing?.id || uuidv4();
    const metadata = {
      meeting: args.meeting || null,
      ki: args.ki || null,
      tdocIds: [...new Set(args.tdocIds.map((item) => item.toUpperCase()))],
      runId: context.run.id,
      agentId: context.agent?.id || null,
      contentHash,
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
      throw error;
    }
  },
});

module.exports = {
  publishReport,
  publicationOutput,
  MAX_REPORT_BYTES,
};
