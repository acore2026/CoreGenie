const AdmZip = require("adm-zip");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const threeGppCatalog = require("../../utils/threeGppCatalog");
const {
  DIRECTORY_BY_GROUP,
  MAX_TDOC_ARCHIVE_BYTES,
  existingFile,
  fetchOfficial,
  meetingFoldersForYear,
} = require("./shared.ts");

type ParsedTdoc = import("./shared.ts").ParsedTdoc;

async function downloadOfficialTdoc(
  parsed: ParsedTdoc,
  context: { signal?: AbortSignal },
  manager: { validatePath: (p: string) => Promise<string> },
  {
    destinationRoot = null,
    meetingFolder = null,
    archiveUrl = null,
  }: {
    destinationRoot?: string | null;
    meetingFolder?: string | null;
    archiveUrl?: string | null;
  } = {}
) {
  const directory = DIRECTORY_BY_GROUP[parsed.group];
  const baseUrl = `https://www.3gpp.org/ftp/${directory}/`;
  if (archiveUrl) {
    const url = threeGppCatalog.officialUrl(archiveUrl);
    const expected = new URL(
      `${encodeURIComponent(meetingFolder || "")}/Docs/${parsed.tdoc}.zip`,
      baseUrl
    );
    if (
      !meetingFolder ||
      decodeURIComponent(url.pathname).toLowerCase() !==
        decodeURIComponent(expected.pathname).toLowerCase()
    )
      throw new Error("提案下载地址与所选会议或 TDoc 不一致。");
  }
  let folders: string[] | null = meetingFolder ? [meetingFolder] : null;
  if (!folders) {
    const listing = await fetchOfficial(baseUrl, context);
    if (!listing.ok)
      return {
        ok: false,
        code: `HTTP_${listing.status}`,
        summary: `3GPP 官方目录返回 HTTP ${listing.status}，暂时无法查找 ${parsed.tdoc}。`,
        retryable: listing.status === 429 || listing.status >= 500,
      };
    folders = meetingFoldersForYear(
      await listing.text(),
      parsed.group,
      parsed.year
    );
  }
  if (!folders || !folders.length)
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
    if (((await existingFile(docxPath))?.size || 0) > 0) {
      return {
        ok: true,
        folder,
        docxRelative,
        officialUrl:
          archiveUrl ||
          new URL(
            `${encodeURIComponent(folder)}/Docs/${parsed.tdoc}.zip`,
            baseUrl
          ).toString(),
        cached: true,
      };
    }

    const officialUrl =
      archiveUrl ||
      new URL(
        `${encodeURIComponent(folder)}/Docs/${parsed.tdoc}.zip`,
        baseUrl
      ).toString();
    const response = await fetchOfficial(officialUrl, context, 120_000);
    if (response.status === 404) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403 && !meetingFolder) continue;
      return {
        ok: false,
        code: `HTTP_${response.status}`,
        summary: `下载 ${parsed.tdoc} 时，3GPP 官方网站返回 HTTP ${response.status}。`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_TDOC_ARCHIVE_BYTES) {
      await response.body?.cancel();
      return {
        ok: false,
        code: "TDOC_TOO_LARGE",
        summary: `${parsed.tdoc} 的压缩包超过 100 MiB，已停止下载。`,
        retryable: false,
      };
    }
    const chunks: Buffer[] = [];
    let received = 0;
    if (response.body) {
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        if (received > MAX_TDOC_ARCHIVE_BYTES)
          throw new Error("官方 ZIP 超过 100 MiB，已停止下载。");
        chunks.push(Buffer.from(chunk));
      }
    } else chunks.push(Buffer.from(await response.arrayBuffer()));
    const buffer = Buffer.concat(chunks);
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
        (entry: { isDirectory: boolean; entryName: string }) =>
          !entry.isDirectory &&
          entry.entryName.toLowerCase().endsWith(".docx") &&
          !entry.entryName.includes("../")
      );
    const selected =
      docxEntries.find((entry: { entryName: string }) =>
        path.basename(entry.entryName).toUpperCase().startsWith(parsed.tdoc)
      ) || (docxEntries.length === 1 ? docxEntries[0] : null);
    if (!selected)
      return {
        ok: false,
        code: "DOCX_NOT_UNIQUE",
        summary: `${parsed.tdoc} 的官方 ZIP 中没有找到唯一的 DOCX。`,
        retryable: false,
      };
    if (selected.header.size > MAX_TDOC_ARCHIVE_BYTES)
      return {
        ok: false,
        code: "INVALID_DOCX",
        summary: `${parsed.tdoc} 解压后的 DOCX 超过 100 MiB。`,
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
    const part = `${docxPath}.${crypto.randomUUID()}.part`;
    try {
      await fs.writeFile(part, docx);
      await fs.rename(part, docxPath);
    } finally {
      await fs.rm(part, { force: true });
    }
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

async function copyConvertedDeliverable(
  manager: { validatePath: (p: string) => Promise<string> },
  temporaryRelative: string,
  proposalRoot: string,
  tdoc: string
): Promise<{ warnings: string[] }> {
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
    // Rewrite only relative link destinations, never prose or remote URLs.
    markdown = markdown.replace(
      new RegExp(`(\\]\\(<?|(?:src|href)=["'])${directory}/`, "g"),
      `$1${tdoc}.assets/${directory}/`
    );
  }
  await fs.writeFile(path.join(proposalRoot, `${tdoc}.md`), markdown, "utf8");
  return {
    warnings: Array.isArray(summary.warnings)
      ? summary.warnings.map(String)
      : [],
  };
}

module.exports = {
  downloadOfficialTdoc,
  copyConvertedDeliverable,
};
