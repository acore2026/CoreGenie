const { z } = require("zod");
const { load } = require("cheerio");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { defineTool } = require("./descriptor");

const execFileAsync = promisify(execFile);

const DIRECTORY_BY_GROUP = Object.freeze({
  SA1: "tsg_sa/WG1_Serv",
  SA2: "tsg_sa/WG2_Arch",
  SA3: "tsg_sa/WG3_Security",
  SA5: "tsg_sa/WG5_OAM",
  CT1: "tsg_ct/WG1_NAS",
  CT4: "tsg_ct/WG4_PROCO",
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
    "Resolve an official 3GPP meeting directory from a supported working group and meeting number without guessing FTP paths.",
  schema: z.object({
    group: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => Object.hasOwn(DIRECTORY_BY_GROUP, value), {
        message: `Supported groups: ${Object.keys(DIRECTORY_BY_GROUP).join(", ")}`,
      }),
    meeting_number: z.number().int().positive(),
    include_invitation: z
      .boolean()
      .default(true)
      .describe(
        "Extract the first two pages of the official meeting invitation when available. Keep enabled for exact date or venue questions."
      ),
  }),
  action: false,
  retry: { maxAttempts: 1 },
  activity: ({ group, meeting_number }) =>
    `Resolving ${String(group).toUpperCase()}#${meeting_number} from the official 3GPP directory`,
  execute: async (
    { group, meeting_number, include_invitation = true },
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
    const folders = meetingFolders(
      await response.text(),
      normalizedGroup,
      meeting_number
    );
    if (!folders.length) {
      return {
        ok: false,
        code: "MEETING_NOT_FOUND",
        summary: `${normalizedGroup}#${meeting_number} was not found in the official working-group directory. Do not guess another directory name.`,
        data: {
          group: normalizedGroup,
          meetingNumber: meeting_number,
          baseUrl,
        },
        retryable: false,
      };
    }
    const primaryPattern = primaryMeetingFolderPattern(
      normalizedGroup,
      meeting_number
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
      meetingNumber: meeting_number,
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

module.exports = {
  DIRECTORY_BY_GROUP,
  meetingFolderPattern,
  meetingFolders,
  officialPdfLinks,
  primaryMeetingFolderPattern,
  resolveMeeting,
};
