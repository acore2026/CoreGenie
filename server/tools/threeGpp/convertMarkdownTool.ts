const { z } = require("zod");
const fs = require("fs/promises");
const path = require("path");
const { defineTool } = require("../descriptor");
const { AgentRunArtifact } = require("../../models/agentRunArtifact");
const { resolveAvailableSkill } = require("../../agent-skills/registry");
const { workspaceFileRelativePath } = require("../../agent-system/attachments");
const filesystem = require("../../services/workspaceFiles");
const sandbox = require("../../services/sandbox");
const { sandboxToolResult } = require("../sandboxResult");
const {
  ensureConversionSkill,
  existingFile,
  parseTdoc,
  shellQuote,
} = require("./shared.ts");
const { downloadOfficialTdoc } = require("./downloadOfficial.ts");

const convertMarkdown = defineTool({
  id: "3gpp.convert-markdown",
  name: "convert_3gpp_markdown",
  description:
    "Download one official 3GPP TDoc or use one uploaded DOCX, convert it to Markdown with original images, verify the ZIP, and attach the ZIP to the chat.",
  schema: z
    .object({
      tdoc: z
        .string()
        .trim()
        .optional()
        .describe("One TDoc number such as S2-2606085."),
      input_path: z
        .string()
        .trim()
        .optional()
        .describe(
          "The exact uploaded DOCX path from <workspace_files>, such as /workspace/uploads/<id>/<file>.docx."
        ),
    })
    .superRefine(
      (
        value: { tdoc?: string; input_path?: string },
        issue: { addIssue: (arg: Record<string, any>) => void }
      ) => {
        if (Boolean(value.tdoc) === Boolean(value.input_path))
          issue.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide exactly one of tdoc or input_path.",
          });
      }
    ),
  action: true,
  effect: "write",
  idempotency: "none",
  retry: { maxAttempts: 1 },
  maxResultBytes: 16 * 1024,
  activity: ({ tdoc, input_path }: { tdoc?: string; input_path?: string }) =>
    tdoc
      ? `下载并转换 ${String(tdoc).toUpperCase()}`
      : `转换已上传的 ${path.basename(String(input_path || "DOCX"))}`,
  execute: async (
    { tdoc, input_path }: { tdoc?: string; input_path?: string },
    context: Record<string, any>
  ) => {
    const skill = await resolveAvailableSkill(
      context.agent,
      context.workspace,
      "3gpp-review"
    );
    if (!skill)
      return {
        ok: false,
        code: "SKILL_NOT_AVAILABLE",
        summary: "当前 Agent 未绑定 3gpp-review Skill，不能开始转换。",
        retryable: false,
      };
    await ensureConversionSkill(skill, context);

    const manager = filesystem.forWorkspace(context.workspace.id);
    await manager.ensureInitialized();
    let sourceRelative: string;
    let official: Record<string, any> | null = null;
    let parsed: { tdoc: string; group: string; year: number } | null = null;
    if (tdoc) {
      parsed = parseTdoc(tdoc);
      if (!parsed)
        return {
          ok: false,
          code: "INVALID_TDOC",
          summary: "TDoc 编号格式不正确或工作组暂不支持。",
          retryable: false,
        };
      official = await downloadOfficialTdoc(parsed, context, manager);
      if (!official || !official.ok) return official;
      sourceRelative = official.docxRelative;
    } else {
      sourceRelative = workspaceFileRelativePath(input_path);
      if (!sourceRelative)
        return {
          ok: false,
          code: "INVALID_UPLOAD_PATH",
          summary: "上传文件路径无效，请重新上传 DOCX。",
          retryable: false,
        };
      const source = await manager.validatePath(sourceRelative);
      const stats = await existingFile(source);
      if (!stats)
        return {
          ok: false,
          code: "DOCX_NOT_FOUND",
          summary: "上传的 DOCX 不存在，请重新上传。",
          retryable: false,
        };
    }

    const source = await manager.validatePath(sourceRelative);
    const sourceStats = await fs.stat(source);
    if (!sourceStats.isFile())
      return {
        ok: false,
        code: "DOCX_NOT_FOUND",
        summary: "待转换的 DOCX 不存在。",
        retryable: false,
      };
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const resultRelative = `3gpp-markdown/results/${stamp}-${String(
      context.run.id
    ).slice(0, 8)}`;
    const result = await manager.validatePath(resultRelative);
    await fs.mkdir(result, { recursive: true });
    const code = [
      "set -euo pipefail",
      `python3 scripts/3gpp_tdocs.py convert-docx --input ${shellQuote(
        `/workspace/${sourceRelative}`
      )} --output ${shellQuote(`/workspace/${resultRelative}`)}`,
    ].join("\n");
    const execution = await sandbox.run({
      language: "bash",
      code,
      workspaceId: context.workspace.id,
      invocationId: context.run.id,
      timeoutSeconds: 900,
      skill: {
        id: skill.id,
        name: skill.name,
        scope: skill.scope,
        revision: skill.revision,
      },
    });
    await context.emit("skill.script.executed", {
      name: skill.name,
      scope: skill.scope,
      revision: skill.revision,
      language: "bash",
    });
    const executionResult = sandboxToolResult(execution, 900);
    if (!executionResult.ok) return executionResult;

    const summaryRelative = `${resultRelative}/conversion-summary.json`;
    const summaryPath = await manager.validatePath(summaryRelative);
    let conversion: Record<string, any>;
    try {
      conversion = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    } catch {
      return {
        ok: false,
        code: "CONVERSION_SUMMARY_MISSING",
        summary: "转换命令已结束，但没有生成有效的 conversion-summary.json。",
        retryable: false,
      };
    }
    const markdownName = path.posix.basename(String(conversion.markdown || ""));
    if (!markdownName || markdownName !== conversion.markdown)
      return {
        ok: false,
        code: "MARKDOWN_PATH_INVALID",
        summary: "转换结果中的 Markdown 路径无效。",
        retryable: false,
      };
    const markdownRelative = `${resultRelative}/${markdownName}`;
    const archiveRelative = `${resultRelative}.zip`;
    const [markdownStats, archiveStats] = await Promise.all([
      fs.stat(await manager.validatePath(markdownRelative)),
      fs.stat(await manager.validatePath(archiveRelative)),
    ]);
    if (!markdownStats.isFile() || !archiveStats.isFile())
      return {
        ok: false,
        code: "CONVERSION_FILES_MISSING",
        summary: "转换结束后没有找到 Markdown 或 ZIP。",
        retryable: false,
      };

    const displayName = `${parsed?.tdoc || path.basename(sourceRelative, ".docx")}.zip`;
    const artifact = await AgentRunArtifact.create({
      runId: context.run.id,
      taskId: context.taskId,
      kind: "workspaceFile",
      title: displayName,
      mimeType: "application/zip",
      storagePath: archiveRelative,
      byteSize: archiveStats.size,
      metadata: {
        filename: displayName,
        role: "3gpp-markdown-package",
        tdoc: parsed?.tdoc || null,
        markdownPath: markdownRelative,
      },
    });
    const warnings = Array.isArray(conversion.warnings)
      ? conversion.warnings.map(String)
      : [];
    return {
      ok: true,
      code: parsed ? "TDOC_CONVERTED" : "DOCX_CONVERTED",
      summary: `${parsed?.tdoc || path.basename(sourceRelative)} 已转换完成，ZIP 已生成并检查。`,
      data: {
        tdoc: parsed?.tdoc || null,
        meetingFolder: official?.folder || null,
        officialUrl: official?.officialUrl || null,
        cachedDownload: official?.cached || false,
        markdownPath: `/workspace/${markdownRelative}`,
        archivePath: `/workspace/${archiveRelative}`,
        imageCount: Array.isArray(conversion.images)
          ? conversion.images.length
          : 0,
        embeddedCount: Array.isArray(conversion.embedded)
          ? conversion.embedded.length
          : 0,
        warnings,
      },
      retryable: false,
      evidenceIds: [],
      artifactIds: [artifact.id],
    };
  },
});

module.exports = { convertMarkdown };
