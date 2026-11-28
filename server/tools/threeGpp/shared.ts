const { load } = require("cheerio");
const fs = require("fs/promises");
const { setTimeout: pause } = require("timers/promises");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const MAX_TDOC_ARCHIVE_BYTES = 100 * 1024 * 1024;

const DIRECTORY_BY_GROUP: Readonly<Record<string, string>> = Object.freeze({
  SA1: "tsg_sa/WG1_Serv",
  SA2: "tsg_sa/WG2_Arch",
  SA3: "tsg_sa/WG3_Security",
  SA5: "tsg_sa/WG5_OAM",
  CT1: "tsg_ct/WG1_mm-cc-sm_ex-CN1",
  CT4: "tsg_ct/WG4_protocollars_ex-CN4",
});

const GROUP_BY_TDOC_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  S1: "SA1",
  S2: "SA2",
  S3: "SA3",
  S5: "SA5",
  C1: "CT1",
  C4: "CT4",
});

export interface ParsedTdoc {
  tdoc: string;
  group: string;
  year: number;
}

function groupFolderPrefix(group: string): string {
  return group.startsWith("SA") ? `TSGS${group.slice(2)}` : `TSG${group}`;
}

function parseTdoc(value: unknown): ParsedTdoc | null {
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

async function ensureConversionSkill(
  skill: Record<string, any> | null,
  context: Record<string, any>
) {
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

function decodeFolder(value: unknown): string {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function meetingFoldersForYear(
  html: unknown,
  group: string,
  year: number
): string[] {
  const prefix = groupFolderPrefix(group);
  const pattern = new RegExp(
    `^${prefix}[_-]\\d+[A-Za-z0-9._-]*_${year}-\\d{2}(?:-\\d{2})?$`,
    "i"
  );
  const inlinePattern = new RegExp(
    `${prefix}[_-]\\d+[A-Za-z0-9._-]*_${year}-\\d{2}(?:-\\d{2})?`,
    "gi"
  );
  const folders = new Set<string>();
  const $ = load(String(html || ""));
  $("a[href]").each((_: unknown, element: unknown) => {
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

  const sortValue = (folder: string) => {
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

function latestMeeting(
  html: unknown,
  group: string,
  asOf: Date = new Date()
): { folder: string; meetingNumber: number } | null {
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

function requestSignal(signal?: AbortSignal, timeoutMs = 120_000): AbortSignal {
  return AbortSignal.any([
    signal || new AbortController().signal,
    AbortSignal.timeout(timeoutMs),
  ]);
}

async function fetchOfficial(
  url: string,
  context: { signal?: AbortSignal },
  timeoutMs = 120_000
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: requestSignal(context.signal, timeoutMs),
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/zip,application/octet-stream;q=0.9,*/*;q=0.8",
        },
      });
      if (attempt >= 2 || ![429, 500, 502, 503, 504].includes(response.status))
        return response;
      await response.body?.cancel();
    } catch (error) {
      if (context.signal?.aborted || attempt >= 2) throw error;
    }
    await pause(500 * 2 ** attempt, undefined, { signal: context.signal });
  }
}

async function existingFile(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function safeWorkspaceSegment(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9#._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function meetingNumberFromInput(group: string, value: unknown): number | null {
  const match = String(value || "")
    .trim()
    .match(new RegExp(`^${group}#(\\d+)$`, "i"));
  return match ? Number(match[1]) : null;
}

function kiNumber(value: unknown): string | null {
  const match = String(value || "")
    .trim()
    .match(/^KI\s*#?\s*(\d+(?:\.\d+)*)$/i);
  return match ? match[1] : null;
}

function agendaItemsForKi(
  items: Array<Record<string, any>>,
  ki: unknown
): Array<Record<string, any>> {
  const number = kiNumber(ki);
  if (!number) return [];
  const escaped = number.replace(/\./g, "\\.");
  const pattern = new RegExp(
    `\\bKI\\s*#?\\s*${escaped}(?![\\d.]|[A-Za-z])`,
    "i"
  );
  return items.filter((item) =>
    pattern.test(
      [item.label, item.title, item.description, item.referenceTitle]
        .filter(Boolean)
        .join(" ")
    )
  );
}

function meetingFolderPattern(group: string, meetingNumber: number): RegExp {
  const escaped = String(meetingNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = group.startsWith("SA")
    ? `TSGS${group.slice(2)}`
    : `TSG${group}`;
  return new RegExp(`^${prefix}[_-]${escaped}(?:[_-]|$)`, "i");
}

function primaryMeetingFolderPattern(
  group: string,
  meetingNumber: number
): RegExp {
  const escaped = String(meetingNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = group.startsWith("SA")
    ? `TSGS${group.slice(2)}`
    : `TSG${group}`;
  return new RegExp(`^${prefix}_${escaped}_`, "i");
}

function meetingFolders(
  html: unknown,
  group: string,
  meetingNumber: number
): string[] {
  const pattern = meetingFolderPattern(group, meetingNumber);
  const values = new Set<string>();
  const $ = load(String(html || ""));
  $("a[href]").each((_: unknown, element: unknown) => {
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

function officialPdfLinks(html: unknown, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  const $ = load(String(html || ""));
  $("a[href]").each((_: unknown, element: unknown) => {
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

module.exports = {
  USER_AGENT,
  MAX_TDOC_ARCHIVE_BYTES,
  DIRECTORY_BY_GROUP,
  GROUP_BY_TDOC_PREFIX,
  groupFolderPrefix,
  parseTdoc,
  ensureConversionSkill,
  decodeFolder,
  meetingFoldersForYear,
  latestMeeting,
  requestSignal,
  fetchOfficial,
  existingFile,
  shellQuote,
  safeWorkspaceSegment,
  meetingNumberFromInput,
  kiNumber,
  agendaItemsForKi,
  meetingFolderPattern,
  primaryMeetingFolderPattern,
  meetingFolders,
  officialPdfLinks,
};
