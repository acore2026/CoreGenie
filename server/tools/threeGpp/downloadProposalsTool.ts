const { z } = require("zod");
const fs = require("fs/promises");
const path = require("path");
const { defineTool } = require("../descriptor");
const { resolveAvailableSkill } = require("../../agent-skills/registry");
const filesystem = require("../../services/workspaceFiles");
const sandbox = require("../../services/sandbox");
const { sandboxToolResult } = require("../sandboxResult");
const threeGppCatalog = require("../../utils/threeGppCatalog");
const threeGppDocuments = require("../../utils/threeGppDocuments");
const {
  selectMeeting,
  selectKiDocuments,
  selectAgendaDocuments,
  requestedSpec,
} = require("../threeGppSelection");
const {
  DIRECTORY_BY_GROUP,
  ensureConversionSkill,
  existingFile,
  kiNumber,
  parseTdoc,
  safeWorkspaceSegment,
  shellQuote,
} = require("./shared.ts");
const {
  copyConvertedDeliverable,
  downloadOfficialTdoc,
} = require("./downloadOfficial.ts");

const downloadProposals = defineTool({
  id: "3gpp.download",
  name: "download_3gpp_proposals",
  description:
    "按官方会议的 KI、议程项或工作项目下载并转换提案。KI 模式使用 ki；CT1/CT4 等按议题组织的会议应省略 ki，提供 agenda_item 或 work_item（如 FS_6G_CPCN_CT），包括对应子议程。禁止把议程编号或项目名伪装成 KI。spec 只填写本次确需限制的 TR/TS；CT 和议程模式不从提示词推测规范号。meeting 使用准确目录或 URL。保留修订、撤回标记及范围提示，重试复用已完成文件。",
  schema: z.object({
    group: z.string().trim().toUpperCase(),
    meeting: z.string().trim().min(1).max(300),
    ki: z.array(z.string().trim().min(1).max(40)).min(1).max(20).optional(),
    work_item: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/)
      .optional(),
    spec: z
      .string()
      .trim()
      .regex(/^(?:(?:TR|TS)\s*)?\d{2}\.\d{3}(?:-\d{2})?$/i)
      .optional(),
    agenda_item: z
      .string()
      .regex(/^\d+(?:\.\d+)*$/)
      .optional(),
  }),
  action: true,
  effect: "write",
  idempotency: "none",
  retry: { maxAttempts: 1 },
  maxResultBytes: 24 * 1024,
  activity: ({ group, meeting }: { group: string; meeting: string }) =>
    `下载 ${group} ${meeting} 的官方提案`,
  execute: async (
    {
      group,
      meeting,
      ki,
      spec,
      agenda_item,
      work_item,
    }: {
      group: string;
      meeting: string;
      ki?: string[];
      spec?: string;
      agenda_item?: string;
      work_item?: string;
    },
    context: Record<string, any>
  ) => {
    context.signal?.throwIfAborted();
    if (!DIRECTORY_BY_GROUP[group])
      return {
        ok: false,
        code: "INVALID_GROUP",
        summary:
          "下载工具目前支持 SA1、SA2、SA3、SA5、CT1、CT4。其他工作组请提供原始文档。",
        retryable: false,
      };
    const hasKi = Boolean(ki?.length);
    if ((!hasKi && !agenda_item && !work_item) || (hasKi && work_item))
      return {
        ok: false,
        code: "INVALID_SCOPE",
        summary:
          "请使用 ki，或省略 ki 并提供 agenda_item/work_item；不能把工作项目名当作 KI。",
        retryable: false,
      };
    if (agenda_item && hasKi && ki && ki.length !== 1)
      return {
        ok: false,
        code: "INVALID_SCOPE",
        summary: "指定 agenda_item 时每次只选择一个 KI。",
        retryable: false,
      };
    const manager = filesystem.forWorkspace(context.workspace.id);
    await manager.ensureInitialized();
    const skill = await resolveAvailableSkill(
      context.agent,
      context.workspace,
      "3gpp-review"
    );
    if (!skill)
      return {
        ok: false,
        code: "SKILL_NOT_AVAILABLE",
        summary: "当前 Agent 未绑定 3gpp-review Skill，不能下载和转换提案。",
        retryable: false,
      };
    await ensureConversionSkill(skill, context);
    const meetings = await threeGppCatalog.meetings(group);
    const candidates = selectMeeting(meetings.meetings, group, meeting);
    if (candidates.length > 1)
      return {
        ok: false,
        code: "AMBIGUOUS_MEETING",
        summary:
          "找到多个会议，请将 candidates 中准确的 id 或 source 作为 meeting 重试。",
        data: { candidates },
        retryable: false,
      };
    const snapshot = candidates[0];
    if (!snapshot)
      return {
        ok: false,
        code: "MEETING_NOT_FOUND",
        summary: `官方目录中没有找到 ${meeting}。meeting 可用会议号、官方目录 id 或准确 URL。`,
        retryable: false,
      };
    const number = snapshot.number;
    const scopeSpec = requestedSpec(
      spec,
      hasKi && group.startsWith("SA") ? context.run.prompt : ""
    );
    const meetingAgenda = await threeGppDocuments.meetingDocuments(
      group,
      snapshot,
      {
        signal: context.signal,
      }
    );
    const runId = `${Date.now()}-${String(context.run.id).slice(0, 12)}`;
    const temporaryRoot = `tmp/3gpp/${runId}`;
    const temporaryPath = await manager.validatePath(temporaryRoot);
    const outputs: Array<Record<string, any>> = [];
    const failures: Array<Record<string, any>> = [];
    const selections: Array<Record<string, any>> = [];
    const selectionSnapshots: Array<Record<string, any>> = [];
    const pendingDocuments: Array<Record<string, any>> = [];
    try {
      for (const requestedKi of hasKi ? [...new Set(ki)] : [null]) {
        const normalizedKi = kiNumber(requestedKi);
        if (hasKi && !normalizedKi) {
          failures.push({
            ki: requestedKi,
            code: "INVALID_KI",
            error:
              "KI 必须写成 KI18 或 KI#18；按议题下载请省略 ki 并提供 agenda_item 或 work_item。",
          });
          continue;
        }
        const selection = hasKi
          ? selectKiDocuments(
              meetingAgenda,
              requestedKi,
              scopeSpec,
              agenda_item
            )
          : selectAgendaDocuments(
              meetingAgenda,
              scopeSpec,
              agenda_item,
              work_item
            );
        if (selection.code) {
          failures.push({
            ki: requestedKi,
            code: selection.code,
            error: selection.error,
            candidates: selection.candidates,
            retryable: false,
          });
          continue;
        }
        const scope = {
          type: hasKi ? "ki" : work_item ? "work_item" : "agenda",
          agendaItem: selection.agendaItem,
          ...(work_item ? { workItem: work_item } : {}),
        };
        const scopeKey = hasKi
          ? `KI${normalizedKi}`
          : `agenda-${selection.agendaItem}`;
        selections.push({
          ki: requestedKi,
          scope,
          agendaItem: selection.agendaItem,
          title: selection.title,
          count: selection.documents.length,
          source: meetingAgenda.source,
        });
        selectionSnapshots.push({
          ki: requestedKi,
          scope,
          agendaItem: selection.agendaItem,
          proposals: selection.documents,
        });
        const downloadable = selection.documents.filter(
          (document: Record<string, any>) => {
            if (document.availability === "reserved") {
              pendingDocuments.push({
                ki: requestedKi,
                tdoc: document.document,
                status: document.status,
                title: document.title,
              });
              return false;
            }
            if (document.availability === "missing") {
              failures.push({
                ki: requestedKi,
                tdoc: document.document,
                code: "TDOC_ARCHIVE_NOT_LISTED",
                error: "官方清单已列出该提案，但 Docs 目录中没有对应 ZIP。",
                retryable: true,
              });
              return false;
            }
            return true;
          }
        );
        const tdocs: string[] = [
          ...new Set<string>(
            downloadable.map((d: { document: string }) => d.document)
          ),
        ];
        const rootName = `${safeWorkspaceSegment(snapshot.id)}-${scopeSpec || "agenda"}-${selection.agendaItem}-${scopeKey}`;
        const proposalRelative = `3gpp/${rootName}/proposal`;
        const proposalRoot = await manager.validatePath(proposalRelative);
        await fs.mkdir(proposalRoot, { recursive: true });
        const files: Array<Record<string, any>> = [];
        const kiTempRelative = `${temporaryRoot}/${safeWorkspaceSegment(scopeKey)}`;
        const manifestRelative = `${kiTempRelative}/proposals.json`;
        const kiTempPath = await manager.validatePath(kiTempRelative);
        await fs.mkdir(kiTempPath, { recursive: true });
        await fs.writeFile(
          await manager.validatePath(manifestRelative),
          JSON.stringify(
            {
              schema: "3gpp-download-selection/v1",
              selectionSource: meetingAgenda.selectionSource,
              source: meetingAgenda.source,
              docsSource: meetingAgenda.docsSource,
              fetchedAt: meetingAgenda.fetchedAt,
              warnings: meetingAgenda.warnings,
              sourceErrors: meetingAgenda.sourceErrors,
              unindexedTdocs: meetingAgenda.unindexedTdocs,
              completeness: "unknown",
              spec: scopeSpec,
              agendaItem: selection.agendaItem,
              agenda_filter: requestedKi,
              scope,
              count: selection.documents.length,
              proposals: selection.documents,
            },
            null,
            2
          ) + "\n",
          "utf8"
        );
        await fs.copyFile(
          await manager.validatePath(manifestRelative),
          await manager.validatePath(`3gpp/${rootName}/tdoc-manifest.json`)
        );
        for (const tdoc of tdocs) {
          const metadata = downloadable.find(
            (document: { document: string }) => document.document === tdoc
          );
          const fileMetadata = {
            status: metadata.status,
            withdrawn: /^withdrawn$/i.test(metadata.status),
            officialUrl: metadata.downloadUrl,
          };
          try {
            context.signal?.throwIfAborted();
            const sourceRelative = `${proposalRelative}/${tdoc}.docx`;
            const sourcePath = await manager.validatePath(sourceRelative);
            const receiptPath = await manager.validatePath(
              `${proposalRelative}/${tdoc}.receipt.json`
            );
            const markdownPath = await manager.validatePath(
              `${proposalRelative}/${tdoc}.md`
            );
            let receipt: Record<string, any> | undefined;
            try {
              receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
            } catch {}
            const docxStats = await existingFile(sourcePath);
            const markdownStats = await existingFile(markdownPath);
            if (
              receipt &&
              receipt.revision === skill.revision &&
              receipt.docxSize === docxStats?.size &&
              receipt.markdownSize === markdownStats?.size &&
              (docxStats?.size || 0) > 0 &&
              (markdownStats?.size || 0) > 0
            ) {
              files.push({
                tdoc,
                ...fileMetadata,
                docx: `/workspace/${sourceRelative}`,
                markdown: `/workspace/${proposalRelative}/${tdoc}.md`,
                cached: true,
                warnings: receipt.warnings || [],
              });
              continue;
            }
            const downloaded = await downloadOfficialTdoc(
              parseTdoc(tdoc),
              context,
              manager,
              {
                destinationRoot: proposalRelative,
                meetingFolder: snapshot.id,
                archiveUrl: metadata.downloadUrl,
              }
            );
            if (!downloaded.ok) {
              failures.push({
                ki: requestedKi,
                tdoc,
                code: downloaded.code,
                error: downloaded.summary,
                retryable: downloaded.retryable,
              });
              continue;
            }
            const tempRelative = `${kiTempRelative}/${safeWorkspaceSegment(tdoc)}`;
            const tempPath = await manager.validatePath(tempRelative);
            await fs.mkdir(tempPath, { recursive: true });
            const execution = await sandbox.run({
              language: "bash",
              code: [
                "set -euo pipefail",
                `python3 scripts/3gpp_tdocs.py convert-docx --input ${shellQuote(`/workspace/${sourceRelative}`)} --output ${shellQuote(`/workspace/${tempRelative}`)}`,
              ].join("\n"),
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
            const result = sandboxToolResult(execution, 900);
            context.signal?.throwIfAborted();
            if (!result.ok) {
              failures.push({
                ki: requestedKi,
                tdoc,
                code: "CONVERSION_FAILED",
                error: String(result.data || result.summary).slice(-1800),
                retryable: result.retryable,
              });
              continue;
            }
            const converted = await copyConvertedDeliverable(
              manager,
              tempRelative,
              proposalRoot,
              tdoc
            );
            await fs.writeFile(
              receiptPath,
              JSON.stringify({
                revision: skill.revision,
                docxSize: (await fs.stat(sourcePath)).size,
                markdownSize: (await fs.stat(markdownPath)).size,
                warnings: converted.warnings,
              }),
              "utf8"
            );
            files.push({
              tdoc,
              ...fileMetadata,
              docx: `/workspace/${proposalRelative}/${tdoc}.docx`,
              markdown: `/workspace/${proposalRelative}/${tdoc}.md`,
              warnings: converted.warnings,
            });
          } catch (error: unknown) {
            const err = error as Error & { code?: string };
            if (context.signal?.aborted) throw error;
            failures.push({
              ki: requestedKi,
              tdoc,
              code: "DOWNLOAD_FAILED",
              error: err.message,
              retryable:
                ["TimeoutError", "TypeError"].includes(err.name) ||
                err.code === "SANDBOX_BUSY",
            });
          } finally {
            await context.emit("task.progress", {
              taskId: context.taskId,
              phase: "download",
              summary: `${group}#${number} ${requestedKi || selection.agendaItem}：已完成 ${files.length}/${tdocs.length} 份，未完成 ${failures.filter((f) => f.ki === requestedKi).length} 份。`,
            });
          }
        }
        outputs.push({
          ki: hasKi ? `KI${normalizedKi}` : null,
          scope,
          directory: `/workspace/3gpp/${rootName}`,
          files,
          agendaItem: selection.agendaItem,
          status: !selection.documents.length
            ? "no_matching_documents_in_source"
            : !tdocs.length &&
                !failures.some((failure) => failure.ki === requestedKi)
              ? "awaiting_upload"
              : failures.some((failure) => failure.ki === requestedKi)
                ? "partial"
                : "downloaded",
        });
      }
      const stateRoot = await manager.validatePath("_meta/tasks");
      await fs.mkdir(stateRoot, { recursive: true });
      await fs.writeFile(
        path.join(stateRoot, `${runId}.json`),
        JSON.stringify(
          {
            schema: "3gpp-download/v1",
            runId,
            group,
            meeting: `${group}#${number}`,
            ki: ki || [],
            agendaItem: agenda_item,
            workItem: work_item,
            selections,
            selectionSnapshots,
            source: meetingAgenda.source,
            selectionSource: meetingAgenda.selectionSource,
            fetchedAt: meetingAgenda.fetchedAt,
            warnings: meetingAgenda.warnings,
            sourceErrors: meetingAgenda.sourceErrors,
            unindexedTdocs: meetingAgenda.unindexedTdocs,
            pendingDocuments,
            outputs,
            failures,
            completedAt: new Date().toISOString(),
          },
          null,
          2
        ) + "\n",
        "utf8"
      );
      const warnings = meetingAgenda.warnings || [];
      const needsAttention =
        warnings.length > 0 ||
        pendingDocuments.length > 0 ||
        outputs.some((item) => !item.files.length);
      // Keep the result structured within the tool's context limit. Full file
      // lists, errors and selection snapshots remain in the durable record.
      let remainingFiles = 10;
      const outputSummary = outputs.map((output) => {
        const files = output.files.slice(0, remainingFiles);
        remainingFiles -= files.length;
        return {
          ...output,
          fileCount: output.files.length,
          files,
          filesTruncated: files.length < output.files.length,
        };
      });
      return {
        ok: outputs.length > 0 && failures.length === 0,
        code: failures.length
          ? "DOWNLOAD_PARTIAL"
          : needsAttention
            ? "DOWNLOAD_INCOMPLETE"
            : "DOWNLOAD_COMPLETE",
        summary: failures.length
          ? `已完成 ${outputs.reduce((sum, item) => sum + item.files.length, 0)} 份提案，另有 ${failures.length} 项未完成。`
          : outputs.every(
                (item) => item.status === "no_matching_documents_in_source"
              )
            ? "当前读取的清单未列出所选范围的提案，不能据此判断尚未上传。"
            : `已下载并转换 ${outputs.reduce((sum, item) => sum + item.files.length, 0)} 份提案${pendingDocuments.length ? `，另有 ${pendingDocuments.length} 份仅预留、尚未在 Docs 中找到 ZIP` : ""}。${warnings.length ? "下载范围尚未确认，请查看来源提示。" : ""}`,
        data: {
          group,
          meeting: `${group}#${number}`,
          outputs: outputSummary,
          failureCount: failures.length,
          failures: failures.slice(0, 10).map((failure) => ({
            ...failure,
            error: failure.error?.slice(0, 500),
          })),
          failuresTruncated:
            failures.length > 10 ||
            failures.some((failure) => (failure.error?.length || 0) > 500),
          selections,
          pendingDocumentCount: pendingDocuments.length,
          pendingDocuments: pendingDocuments.slice(0, 10),
          pendingDocumentsTruncated: pendingDocuments.length > 10,
          source: meetingAgenda.source,
          docsSource: meetingAgenda.docsSource,
          fetchedAt: meetingAgenda.fetchedAt,
          warnings,
          sourceErrors: meetingAgenda.sourceErrors,
          unindexedTdocCount: meetingAgenda.unindexedTdocs?.length || 0,
          unindexedTdocs: meetingAgenda.unindexedTdocs?.slice(0, 20) || [],
          unindexedTdocsTruncated:
            (meetingAgenda.unindexedTdocs?.length || 0) > 20,
          completeness: "unknown",
          selectionSource: meetingAgenda.selectionSource,
          warning: [
            ...warnings,
            "结果仅对应本次读取的官方清单和所选范围，保留修订稿及撤回标记；不代表覆盖 Inbox 草稿、后续上传或整个 KI，也不代表会议已采纳。",
          ].join(" "),
          recordPath: `/workspace/_meta/tasks/${runId}.json`,
        },
        retryable: failures.some((f) => f.retryable),
      };
    } finally {
      await fs.rm(temporaryPath, { recursive: true, force: true });
    }
  },
});

module.exports = { downloadProposals };
