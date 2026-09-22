const { z } = require("zod");
const { load } = require("cheerio");
const AdmZip = require("adm-zip");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { defineTool } = require("./descriptor");
const { AgentRunArtifact } = require("../models/agentRunArtifact");
const { resolveAvailableSkill } = require("../agent-skills/registry");
const { workspaceFileRelativePath } = require("../agent-system/attachments");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");
const sandbox = require("../utils/agents/aibitat/plugins/sandbox/lib");
const { sandboxToolResult } = require("./sandboxResult");
const threeGppCatalog = require("../utils/threeGppCatalog");

const execFileAsync = promisify(execFile);
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const MAX_TDOC_ARCHIVE_BYTES = 100 * 1024 * 1024;

const DIRECTORY_BY_GROUP = Object.freeze({
  SA1: "tsg_sa/WG1_Serv",
  SA2: "tsg_sa/WG2_Arch",
  SA3: "tsg_sa/WG3_Security",
  SA5: "tsg_sa/WG5_OAM",
  CT1: "tsg_ct/WG1_NAS",
  CT4: "tsg_ct/WG4_PROCO",
});

const GROUP_BY_TDOC_PREFIX = Object.freeze({
  S1: "SA1",
  S2: "SA2",
  S3: "SA3",
  S5: "SA5",
  C1: "CT1",
  C4: "CT4",
});

function groupFolderPrefix(group) {
  return group.startsWith("SA") ? `TSGS${group.slice(2)}` : `TSG${group}`;
}

function parseTdoc(value) {
  const match = String(value || "")
    .trim()
    .toUpperCase()
    .match(/^([SC]\d)-(\d{2})\d{4,6}$/);
  if (!match || !GROUP_BY_TDOC_PREFIX[match[1]]) return null;
  return {
    tdoc: match[0],
    group: GROUP_BY_TDOC_PREFIX[match[1]],
    year: 2000 + Number(match[2]),
  };
}

async function ensureConversionSkill(skill, context) {
  if (!skill) return null;
  const active = context.activatedSkill(skill.name);
  if (active?.revision === skill.revision) return active;

  context.activateSkill(skill);
  await context.emit("skill.activated", {
    name: skill.name,
    scope: skill.scope,
    revision: skill.revision,
    automatic: true,
    reason: "required-by-3gpp-conversion",
  });
  return skill;
}

function decodeFolder(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function meetingFoldersForYear(html, group, year) {
  const prefix = groupFolderPrefix(group);
  const pattern = new RegExp(
    `^${prefix}[_-]\\d+[A-Za-z0-9._-]*_${year}-\\d{2}(?:-\\d{2})?$`,
    "i"
  );
  const inlinePattern = new RegExp(
    `${prefix}[_-]\\d+[A-Za-z0-9._-]*_${year}-\\d{2}(?:-\\d{2})?`,
    "gi"
  );
  const folders = new Set();
  const $ = load(String(html || ""));
  $("a[href]").each((_, element) => {
    for (const value of [$(element).attr("href"), $(element).text()]) {
      const folder = decodeFolder(value)
        .replace(/[?#].*$/, "")
        .replace(/\/$/, "")
        .split("/")
        .at(-1);
      if (folder && pattern.test(folder)) folders.add(folder);
    }
  });
  for (const match of String(html || "").matchAll(inlinePattern))
    if (match[0]) folders.add(match[0]);

  const sortValue = (folder) => {
    const date = folder.match(/_(20\d{2})-(\d{2})(?:-(\d{2}))?$/);
    const meeting = folder.match(/[_-](\d+)/);
    return (
      Number(`${date?.[1] || 0}${date?.[2] || "00"}${date?.[3] || "00"}`) *
        10_000 +
      Number(meeting?.[1] || 0)
    );
  };
  return [...folders].sort((a, b) => sortValue(b) - sortValue(a));
}

function latestMeeting(html, group, asOf = new Date()) {
  const year = asOf.getUTCFullYear();
  const currentMonth = Number(
    `${year}${String(asOf.getUTCMonth() + 1).padStart(2, "0")}`
  );
  const folders = [
    ...meetingFoldersForYear(html, group, year),
    ...meetingFoldersForYear(html, group, year - 1),
  ].filter((folder) => {
    const date = folder.match(/_(20\d{2})-(\d{2})(?:-(\d{2}))?$/);
    return Number(`${date?.[1] || 0}${date?.[2] || "00"}`) <= currentMonth;
  });
  const primary = folders.filter((folder) => {
    const prefix = groupFolderPrefix(group);
    return new RegExp(`^${prefix}_(\\d+)_`, "i").test(folder);
  });
  const folder = primary[0] || folders[0] || null;
  if (!folder) return null;
  const prefix = groupFolderPrefix(group);
  const meeting = folder.match(new RegExp(`^${prefix}[_-](\\d+)`, "i"));
  return meeting ? { folder, meetingNumber: Number(meeting[1]) } : null;
}

function requestSignal(signal, timeoutMs = 30_000) {
  return AbortSignal.any([
    signal || new AbortController().signal,
    AbortSignal.timeout(timeoutMs),
  ]);
}

async function fetchOfficial(url, context, timeoutMs = 30_000) {
  return fetch(url, {
    redirect: "follow",
    signal: requestSignal(context.signal, timeoutMs),
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/zip,application/octet-stream;q=0.9,*/*;q=0.8",
    },
  });
}

async function existingFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

async function downloadOfficialTdoc(
  parsed,
  context,
  manager,
  { destinationRoot = null } = {}
) {
  const directory = DIRECTORY_BY_GROUP[parsed.group];
  const baseUrl = `https://www.3gpp.org/ftp/${directory}/`;
  const listing = await fetchOfficial(baseUrl, context);
  if (!listing.ok)
    return {
      ok: false,
      code: `HTTP_${listing.status}`,
      summary: `3GPP 官方目录返回 HTTP ${listing.status}，暂时无法查找 ${parsed.tdoc}。`,
      retryable: listing.status === 429 || listing.status >= 500,
    };
  const folders = meetingFoldersForYear(
    await listing.text(),
    parsed.group,
    parsed.year
  );
  if (!folders.length)
    return {
      ok: false,
      code: "MEETING_YEAR_NOT_FOUND",
      summary: `没有在 3GPP 官方目录中找到 ${parsed.group} ${parsed.year} 年的会议目录。`,
      retryable: false,
    };

  for (const folder of folders) {
    const docsRoot = destinationRoot || `3gpp-review/${folder}/docs`;
    const docxRelative = `${docsRoot}/${parsed.tdoc}.docx`;
    const docxPath = await manager.validatePath(docxRelative);
    if (await existingFile(docxPath)) {
      return {
        ok: true,
        folder,
        docxRelative,
        officialUrl: new URL(
          `${encodeURIComponent(folder)}/Docs/${parsed.tdoc}.zip`,
          baseUrl
        ).toString(),
        cached: true,
      };
    }

    const officialUrl = new URL(
      `${encodeURIComponent(folder)}/Docs/${parsed.tdoc}.zip`,
      baseUrl
    ).toString();
    const response = await fetchOfficial(officialUrl, context, 120_000);
    if (response.status === 404) continue;
    if (!response.ok) {
      if (response.status === 403) continue;
      return {
        ok: false,
        code: `HTTP_${response.status}`,
        summary: `下载 ${parsed.tdoc} 时，3GPP 官方网站返回 HTTP ${response.status}。`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_TDOC_ARCHIVE_BYTES)
      return {
        ok: false,
        code: "TDOC_TOO_LARGE",
        summary: `${parsed.tdoc} 的压缩包超过 100 MiB，已停止下载。`,
        retryable: false,
      };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_TDOC_ARCHIVE_BYTES)
      return {
        ok: false,
        code: "TDOC_TOO_LARGE",
        summary: `${parsed.tdoc} 的压缩包超过 100 MiB，已停止处理。`,
        retryable: false,
      };
    let archive;
    try {
      archive = new AdmZip(buffer);
    } catch {
      return {
        ok: false,
        code: "INVALID_TDOC_ARCHIVE",
        summary: `${parsed.tdoc} 的官方文件不是有效的 ZIP。`,
        retryable: false,
      };
    }
    const docxEntries = archive
      .getEntries()
      .filter(
        (entry) =>
          !entry.isDirectory &&
          entry.entryName.toLowerCase().endsWith(".docx") &&
          !entry.entryName.includes("../")
      );
    const selected =
      docxEntries.find((entry) =>
        path.basename(entry.entryName).toUpperCase().startsWith(parsed.tdoc)
      ) || (docxEntries.length === 1 ? docxEntries[0] : null);
    if (!selected)
      return {
        ok: false,
        code: "DOCX_NOT_UNIQUE",
        summary: `${parsed.tdoc} 的官方 ZIP 中没有找到唯一的 DOCX。`,
        retryable: false,
      };
    const docx = selected.getData();
    if (!docx.length || docx.length > MAX_TDOC_ARCHIVE_BYTES)
      return {
        ok: false,
        code: "INVALID_DOCX",
        summary: `${parsed.tdoc} 的 DOCX 为空或超过 100 MiB。`,
        retryable: false,
      };
    await fs.mkdir(path.dirname(docxPath), { recursive: true });
    // The official ZIP is a transport format, not a workspace deliverable.
    // Keep it in memory and persist only the extracted DOCX.
    await fs.writeFile(docxPath, docx);
    return {
      ok: true,
      folder,
      docxRelative,
      officialUrl,
      cached: false,
    };
  }

  return {
    ok: false,
    code: "TDOC_NOT_FOUND",
    summary: `没有在 ${parsed.group} ${parsed.year} 年的官方会议目录中找到 ${parsed.tdoc}。`,
    retryable: false,
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function safeWorkspaceSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9#._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function meetingNumberFromInput(group, value) {
  const match = String(value || "")
    .trim()
    .match(new RegExp(`^${group}#(\\d+)(?:[A-Za-z]*)$`, "i"));
  return match ? Number(match[1]) : null;
}

function kiNumber(value) {
  const match = String(value || "")
    .trim()
    .match(/^KI\s*#?\s*(\d+(?:\.\d+)*)$/i);
  return match ? match[1] : null;
}

function agendaItemsForKi(items, ki) {
  const number = kiNumber(ki);
  if (!number) return [];
  const pattern = new RegExp(`\\b(?:KI\\s*#?\\s*)${number}\\b`, "i");
  return items.filter((item) =>
    pattern.test(
      [item.label, item.title, item.description, item.referenceTitle]
        .filter(Boolean)
        .join(" ")
    )
  );
}

function tdocsFromAgenda(items, group) {
  const values = new Set();
  for (const item of items) {
    for (const candidate of [
      item.referenceTdoc,
      item.label,
      item.description,
    ]) {
      for (const match of String(candidate || "").matchAll(
        /\b([A-Z]\d-\d{6,8})\b/gi
      )) {
        const parsed = parseTdoc(match[1]);
        if (parsed?.group === group) values.add(parsed.tdoc);
      }
    }
  }
  return [...values].sort();
}

async function copyConvertedDeliverable(
  manager,
  temporaryRelative,
  proposalRoot,
  tdoc
) {
  const temporaryRoot = await manager.validatePath(temporaryRelative);
  const summary = JSON.parse(
    await fs.readFile(
      path.join(temporaryRoot, "conversion-summary.json"),
      "utf8"
    )
  );
  const markdownName = path.basename(String(summary.markdown || ""));
  if (!markdownName || !markdownName.toLowerCase().endsWith(".md"))
    throw new Error(`${tdoc} conversion did not produce Markdown.`);
  let markdown = await fs.readFile(
    path.join(temporaryRoot, markdownName),
    "utf8"
  );
  const assetRoot = path.join(proposalRoot, `${tdoc}.assets`);
  for (const directory of ["assets", "embedded"]) {
    const source = path.join(temporaryRoot, directory);
    try {
      await fs.stat(source);
    } catch {
      continue;
    }
    const destination = path.join(assetRoot, directory);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true, force: true });
    markdown = markdown.replaceAll(
      `${directory}/`,
      `${tdoc}.assets/${directory}/`
    );
  }
  await fs.writeFile(path.join(proposalRoot, `${tdoc}.md`), markdown, "utf8");
  return {
    warnings: Array.isArray(summary.warnings)
      ? summary.warnings.map(String)
      : [],
  };
}

const downloadProposals = defineTool({
  id: "3gpp.download",
  name: "download_3gpp_proposals",
  description:
    "按指定 3GPP 工作组、会议和官方 KI 下载并转换提案，只保留 proposal 下的最终文件。",
  schema: z.object({
    group: z.string().trim().toUpperCase(),
    meeting: z.string().trim().min(1).max(80),
    ki: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  }),
  action: true,
  effect: "write",
  idempotency: "none",
  retry: { maxAttempts: 1 },
  maxResultBytes: 24 * 1024,
  activity: ({ group, meeting }) => `下载 ${group} ${meeting} 的官方 KI 提案`,
  execute: async ({ group, meeting, ki }, context) => {
    if (!threeGppCatalog.GROUPS.includes(group))
      return {
        ok: false,
        code: "INVALID_GROUP",
        summary: "工作组标识无效。",
        retryable: false,
      };
    const number = meetingNumberFromInput(group, meeting);
    if (!number)
      return {
        ok: false,
        code: "INVALID_MEETING",
        summary: `会议必须写成 ${group}#会议号，例如 ${group}#176。`,
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
    const snapshot = meetings.meetings.find((item) => item.number === number);
    if (!snapshot)
      return {
        ok: false,
        code: "MEETING_NOT_FOUND",
        summary: `官方目录中没有找到 ${group}#${number}。`,
        retryable: false,
      };
    const meetingAgenda = await threeGppCatalog.agenda(group, snapshot.id, {
      meeting: snapshot,
    });
    const runId = `${Date.now()}-${String(context.run.id).slice(0, 12)}`;
    const temporaryRoot = `tmp/3gpp/${runId}`;
    const temporaryPath = await manager.validatePath(temporaryRoot);
    const outputs = [];
    const failures = [];
    try {
      for (const requestedKi of [...new Set(ki)]) {
        const normalizedKi = kiNumber(requestedKi);
        if (!normalizedKi) {
          failures.push({
            ki: requestedKi,
            code: "INVALID_KI",
            error: "KI 必须写成 KI18 或 KI#18。",
          });
          continue;
        }
        const matchingItems = agendaItemsForKi(
          meetingAgenda.items,
          requestedKi
        );
        const tdocs = tdocsFromAgenda(matchingItems, group);
        const rootName = `${group}#${number}-KI${normalizedKi}`;
        const proposalRelative = `3gpp/${rootName}/proposal`;
        if (!tdocs.length) {
          failures.push({
            ki: requestedKi,
            code: meetingAgenda.warning
              ? "AGENDA_NOT_AVAILABLE"
              : matchingItems.length
                ? "KI_TDOC_NOT_FOUND"
                : "KI_NOT_FOUND",
            error: meetingAgenda.warning
              ? meetingAgenda.warning
              : matchingItems.length
                ? "官方议程找到 KI 标记，但没有可下载的 TDoc 编号。"
                : "官方议程没有找到这个 KI，未扩大范围下载整场会议。",
          });
          continue;
        }
        const proposalRoot = await manager.validatePath(proposalRelative);
        await fs.mkdir(proposalRoot, { recursive: true });
        const files = [];
        for (const tdoc of tdocs) {
          try {
            const downloaded = await downloadOfficialTdoc(
              parseTdoc(tdoc),
              context,
              manager,
              { destinationRoot: proposalRelative }
            );
            if (!downloaded.ok) {
              failures.push({
                ki: requestedKi,
                tdoc,
                code: downloaded.code,
                error: downloaded.summary,
              });
              continue;
            }
            const tempRelative = `${temporaryRoot}/${safeWorkspaceSegment(tdoc)}`;
            const tempPath = await manager.validatePath(tempRelative);
            await fs.mkdir(tempPath, { recursive: true });
            const execution = await sandbox.run({
              language: "bash",
              code: [
                "set -euo pipefail",
                `python3 scripts/3gpp_tdocs.py convert-docx --input ${shellQuote(`/workspace/${downloaded.docxRelative}`)} --output ${shellQuote(`/workspace/${tempRelative}`)}`,
              ].join("\n"),
              workspaceId: context.workspace.id,
              invocationId: context.run.id,
              timeoutSeconds: 300,
              skill: {
                id: skill.id,
                name: skill.name,
                scope: skill.scope,
                revision: skill.revision,
              },
            });
            const result = sandboxToolResult(execution, 300);
            if (!result.ok) {
              failures.push({
                ki: requestedKi,
                tdoc,
                code: "CONVERSION_FAILED",
                error: result.summary,
              });
              continue;
            }
            const converted = await copyConvertedDeliverable(
              manager,
              tempRelative,
              proposalRoot,
              tdoc
            );
            files.push({
              tdoc,
              docx: `/workspace/${downloaded.docxRelative}`,
              markdown: `/workspace/${proposalRelative}/${tdoc}.md`,
              warnings: converted.warnings,
            });
          } catch (error) {
            failures.push({
              ki: requestedKi,
              tdoc,
              code: "DOWNLOAD_FAILED",
              error: error.message,
            });
          }
        }
        if (files.length)
          outputs.push({
            ki: `KI${normalizedKi}`,
            directory: `/workspace/3gpp/${rootName}`,
            files,
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
            ki,
            outputs,
            failures,
            completedAt: new Date().toISOString(),
          },
          null,
          2
        ) + "\n",
        "utf8"
      );
      return {
        ok: outputs.length > 0 && failures.length === 0,
        code: failures.length ? "DOWNLOAD_PARTIAL" : "DOWNLOAD_COMPLETE",
        summary: failures.length
          ? `已完成 ${outputs.reduce((sum, item) => sum + item.files.length, 0)} 份提案，另有 ${failures.length} 项未完成。`
          : `已下载并转换 ${outputs.reduce((sum, item) => sum + item.files.length, 0)} 份提案。`,
        data: { group, meeting: `${group}#${number}`, outputs, failures },
        retryable: failures.length > 0,
      };
    } finally {
      await fs.rm(temporaryPath, { recursive: true, force: true });
    }
  },
});

function meetingFolderPattern(group, meetingNumber) {
  const escaped = String(meetingNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = group.startsWith("SA")
    ? `TSGS${group.slice(2)}`
    : `TSG${group}`;
  return new RegExp(`^${prefix}[_-]${escaped}(?:[_-]|$)`, "i");
}

function primaryMeetingFolderPattern(group, meetingNumber) {
  const escaped = String(meetingNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = group.startsWith("SA")
    ? `TSGS${group.slice(2)}`
    : `TSG${group}`;
  return new RegExp(`^${prefix}_${escaped}_`, "i");
}

function meetingFolders(html, group, meetingNumber) {
  const pattern = meetingFolderPattern(group, meetingNumber);
  const values = new Set();
  const $ = load(String(html || ""));
  $("a[href]").each((_, element) => {
    const href = String($(element).attr("href") || "");
    const text = String($(element).text() || "");
    for (const candidate of [href, text]) {
      const folder = decodeURIComponent(candidate)
        .replace(/[?#].*$/, "")
        .replace(/\/$/, "")
        .split("/")
        .at(-1);
      if (folder && pattern.test(folder)) values.add(folder);
    }
  });

  // The 3GPP directory application also renders folder names as text in some
  // deployments, without useful anchor hrefs in the initial HTML.
  const textPattern = new RegExp(
    `${pattern.source.replace("^", "").replace("(?:[_-]|$)", "(?:[_-][A-Za-z0-9][A-Za-z0-9._-]*|)")}`,
    "gi"
  );
  for (const match of String(html || "").matchAll(textPattern))
    if (match[0]) values.add(match[0].replace(/[.,;:)]+$/, ""));

  return [...values].sort((a, b) => a.localeCompare(b));
}

function officialPdfLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const $ = load(String(html || ""));
  $("a[href]").each((_, element) => {
    try {
      const target = new URL($(element).attr("href"), base);
      if (
        target.origin === base.origin &&
        target.pathname.startsWith(base.pathname) &&
        target.pathname.toLowerCase().endsWith(".pdf")
      )
        links.add(target.toString());
    } catch {}
  });
  return [...links];
}

async function invitationDetails(meetingUrl, context) {
  const invitationUrl = new URL("Invitation/", meetingUrl).toString();
  try {
    const listing = await fetch(invitationUrl, {
      redirect: "follow",
      signal: AbortSignal.any([
        context.signal || new AbortController().signal,
        AbortSignal.timeout(30_000),
      ]),
      headers: { "User-Agent": "AnythingLLM-Agent/1.0" },
    });
    if (!listing.ok) return null;
    const pdfUrl = officialPdfLinks(await listing.text(), invitationUrl)[0];
    if (!pdfUrl) return null;
    const pdf = await fetch(pdfUrl, {
      redirect: "follow",
      signal: AbortSignal.any([
        context.signal || new AbortController().signal,
        AbortSignal.timeout(30_000),
      ]),
      headers: { "User-Agent": "AnythingLLM-Agent/1.0" },
    });
    if (!pdf.ok) return null;
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "anythingllm-3gpp-meeting-")
    );
    const pdfPath = path.join(temporaryRoot, "invitation.pdf");
    try {
      await fs.writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()));
      const { stdout } = await execFileAsync(
        "pdftotext",
        ["-f", "1", "-l", "2", pdfPath, "-"],
        { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }
      );
      const text = String(stdout || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8_000);
      return text ? { invitationUrl: pdfUrl, invitationText: text } : null;
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  } catch {
    return null;
  }
}

const resolveMeeting = defineTool({
  id: "3gpp.resolve-meeting",
  name: "resolve_3gpp_meeting",
  description:
    "Resolve an official 3GPP meeting directory from a supported working group and either a meeting number or latest=true, without guessing FTP paths.",
  schema: z
    .object({
      group: z
        .string()
        .trim()
        .transform((value) => value.toUpperCase())
        .refine((value) => Object.hasOwn(DIRECTORY_BY_GROUP, value), {
          message: `Supported groups: ${Object.keys(DIRECTORY_BY_GROUP).join(", ")}`,
        }),
      meeting_number: z.number().int().positive().optional(),
      latest: z
        .boolean()
        .default(false)
        .describe(
          "Set true to resolve the most recent regular meeting not later than the current month."
        ),
      include_invitation: z
        .boolean()
        .default(true)
        .describe(
          "Extract the first two pages of the official meeting invitation when available. Keep enabled for exact date or venue questions."
        ),
    })
    .refine(
      (value) => Boolean(value.meeting_number) !== Boolean(value.latest),
      { message: "Provide either meeting_number or latest=true." }
    ),
  action: false,
  retry: { maxAttempts: 1 },
  activity: ({ group, meeting_number, latest }) =>
    `Resolving ${String(group).toUpperCase()}${latest ? " latest meeting" : `#${meeting_number}`} from the official 3GPP directory`,
  execute: async (
    { group, meeting_number, latest = false, include_invitation = true },
    context
  ) => {
    if (context.signal?.aborted) throw new Error("Agent run was cancelled.");
    const normalizedGroup = String(group).toUpperCase();
    const directory = DIRECTORY_BY_GROUP[normalizedGroup];
    const baseUrl = `https://www.3gpp.org/ftp/${directory}/`;
    const response = await fetch(baseUrl, {
      redirect: "follow",
      signal: AbortSignal.any([
        context.signal || new AbortController().signal,
        AbortSignal.timeout(30_000),
      ]),
      headers: { "User-Agent": "AnythingLLM-Agent/1.0" },
    });
    if (!response.ok) {
      return {
        ok: false,
        code: `HTTP_${response.status}`,
        summary: `The official ${normalizedGroup} directory returned HTTP ${response.status} ${response.statusText}.`,
        data: {
          group: normalizedGroup,
          meetingNumber: meeting_number,
          baseUrl,
        },
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    const listing = await response.text();
    const latestResult = latest
      ? latestMeeting(listing, normalizedGroup)
      : null;
    const resolvedMeetingNumber = latestResult?.meetingNumber || meeting_number;
    const folders = meetingFolders(
      listing,
      normalizedGroup,
      resolvedMeetingNumber
    );
    if (!folders.length) {
      return {
        ok: false,
        code: "MEETING_NOT_FOUND",
        summary: latest
          ? `No recent regular ${normalizedGroup} meeting was found in the official working-group directory.`
          : `${normalizedGroup}#${meeting_number} was not found in the official working-group directory. Do not guess another directory name.`,
        data: {
          group: normalizedGroup,
          meetingNumber: resolvedMeetingNumber || null,
          baseUrl,
        },
        retryable: false,
      };
    }
    const primaryPattern = primaryMeetingFolderPattern(
      normalizedGroup,
      resolvedMeetingNumber
    );
    const primaryFolders = folders.filter((folder) =>
      primaryPattern.test(folder)
    );
    const candidateFolders = primaryFolders.length ? primaryFolders : folders;
    const relatedFolders = primaryFolders.length
      ? folders.filter((folder) => !primaryPattern.test(folder))
      : [];
    const entry = (folder) => ({
      folder,
      url: new URL(`${encodeURIComponent(folder)}/`, baseUrl).toString(),
    });
    const candidates = candidateFolders.map(entry);
    return {
      group: normalizedGroup,
      meetingNumber: resolvedMeetingNumber,
      latest: Boolean(latest),
      baseUrl,
      candidates,
      relatedCandidates: relatedFolders.map(entry),
      officialDetails:
        include_invitation && candidates[0]
          ? await invitationDetails(candidates[0].url, context)
          : null,
    };
  },
});

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
    .superRefine((value, issue) => {
      if (Boolean(value.tdoc) === Boolean(value.input_path))
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provide exactly one of tdoc or input_path.",
        });
    }),
  action: true,
  effect: "write",
  idempotency: "none",
  retry: { maxAttempts: 1 },
  maxResultBytes: 16 * 1024,
  activity: ({ tdoc, input_path }) =>
    tdoc
      ? `下载并转换 ${String(tdoc).toUpperCase()}`
      : `转换已上传的 ${path.basename(String(input_path || "DOCX"))}`,
  execute: async ({ tdoc, input_path }, context) => {
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
    let sourceRelative;
    let official = null;
    let parsed = null;
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
      if (!official.ok) return official;
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
      timeoutSeconds: 300,
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
    const executionResult = sandboxToolResult(execution, 300);
    if (!executionResult.ok) return executionResult;

    const summaryRelative = `${resultRelative}/conversion-summary.json`;
    const summaryPath = await manager.validatePath(summaryRelative);
    let conversion;
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

module.exports = {
  DIRECTORY_BY_GROUP,
  GROUP_BY_TDOC_PREFIX,
  convertMarkdown,
  downloadProposals,
  downloadOfficialTdoc,
  ensureConversionSkill,
  latestMeeting,
  meetingFolderPattern,
  meetingFolders,
  meetingFoldersForYear,
  officialPdfLinks,
  parseTdoc,
  primaryMeetingFolderPattern,
  resolveMeeting,
};
