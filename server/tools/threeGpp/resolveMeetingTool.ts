const { z } = require("zod");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { defineTool } = require("../descriptor");
const {
  DIRECTORY_BY_GROUP,
  latestMeeting,
  meetingFolders,
  officialPdfLinks,
  primaryMeetingFolderPattern,
} = require("./shared.ts");

const execFileAsync = promisify(execFile);

async function invitationDetails(
  meetingUrl: string,
  context: { signal?: AbortSignal }
): Promise<{ invitationUrl: string; invitationText: string } | null> {
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
        .transform((value: string) => value.toUpperCase())
        .refine((value: string) => Object.hasOwn(DIRECTORY_BY_GROUP, value), {
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
      (value: { meeting_number?: number; latest?: boolean }) =>
        Boolean(value.meeting_number) !== Boolean(value.latest),
      { message: "Provide either meeting_number or latest=true." }
    ),
  action: false,
  retry: { maxAttempts: 1 },
  activity: ({
    group,
    meeting_number,
    latest,
  }: {
    group: string;
    meeting_number?: number;
    latest?: boolean;
  }) =>
    `Resolving ${String(group).toUpperCase()}${latest ? " latest meeting" : `#${meeting_number}`} from the official 3GPP directory`,
  execute: async (
    {
      group,
      meeting_number,
      latest = false,
      include_invitation = true,
    }: {
      group: string;
      meeting_number?: number;
      latest?: boolean;
      include_invitation?: boolean;
    },
    context: Record<string, any>
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
    const folders: string[] = meetingFolders(
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
    const entry = (folder: string) => ({
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

module.exports = { resolveMeeting };
