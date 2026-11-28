const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const AdmZip = require("adm-zip");
const {
  parseThreeGppArchiveHtml,
  compareVersionsDesc,
} = require("./protocolFinder");

const execFileAsync = promisify(execFile);
const USER_AGENT = "Mozilla/5.0 AnythingLLM-Agent/1.0";
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_BYTES = 20 * 1024 * 1024;

function fail(publicMessage, status = 400) {
  return Object.assign(new Error(publicMessage), { publicMessage, status });
}

function parseSpecInput(rawSpec) {
  if (typeof rawSpec !== "string") {
    throw fail("请提供有效的 3GPP 规范编号，例如 29.574。", 400);
  }
  const cleaned = rawSpec
    .trim()
    .replace(/^3GPP\s+/i, "")
    .replace(/^(?:TS|TR)\s+/i, "");
  const match = cleaned.match(/^(\d{2})\.(\d{3})(?:-(\d{1,2}))?$/);
  if (!match) {
    throw fail("规范编号格式无效，请输入例如 29.574 或 29.522。", 400);
  }
  const [, series, item, rawPart = ""] = match;
  const partNumeric = rawPart ? String(Number(rawPart)) : "";
  const id = rawPart ? `${series}.${item}-${rawPart}` : `${series}.${item}`;
  return { series, item, rawPart, partNumeric, id };
}

function parseReleaseInput(rawRelease) {
  if (typeof rawRelease !== "string") {
    throw fail("请提供有效的 Release，例如 Rel-20。", 400);
  }
  const match = rawRelease.trim().match(/^(?:Rel(?:ease)?[-\s]*)?(\d{2})$/i);
  if (!match) {
    throw fail("Release 格式无效，请输入例如 Rel-18、Rel-19 或 Rel-20。", 400);
  }
  const major = Number(match[1]);
  if (major < 8 || major > 35) {
    throw fail("不支持的 Release 版本。", 400);
  }
  return { major, label: `Rel-${match[1]}` };
}

function parseOptionalVersion(rawVersion) {
  if (rawVersion === undefined || rawVersion === "") return null;
  if (
    typeof rawVersion !== "string" ||
    !/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(rawVersion.trim())
  ) {
    throw fail("版本号格式无效，请输入例如 20.1.0。", 400);
  }
  return rawVersion.trim();
}

function assertOfficialArchiveUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw fail("无效的 3GPP 官方归档地址。", 400);
  }
  if (
    url.origin !== "https://www.3gpp.org" ||
    !url.pathname.startsWith("/ftp/Specs/archive/") ||
    url.username ||
    url.password
  ) {
    throw fail("只允许从 3GPP 官方规范归档目录下载文件。", 400);
  }
  url.hash = "";
  return url.href;
}

async function fetchArchiveDirectory(archiveDir, signal) {
  const safeUrl = assertOfficialArchiveUrl(archiveDir);
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-fsS", "--max-time", "20", "-A", USER_AGENT, safeUrl],
      { maxBuffer: 8 * 1024 * 1024, signal }
    );
    return stdout;
  } catch (error) {
    if (error?.code === 22 && /(?:403|404)/.test(String(error.stderr || ""))) {
      throw fail("3GPP 官方归档中未找到该规范目录。", 404);
    }
    throw fail("暂时无法访问 3GPP 官方规范目录，请稍后重试或手动上传。", 502);
  }
}

async function fetchArchiveZipBuffer(zipUrl, signal) {
  const safeUrl = assertOfficialArchiveUrl(zipUrl);
  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-fsSL",
        "--max-time",
        "60",
        "--max-filesize",
        String(MAX_ZIP_BYTES),
        "-A",
        USER_AGENT,
        safeUrl,
      ],
      { encoding: "buffer", maxBuffer: MAX_ZIP_BYTES + 1024 * 1024, signal }
    );
    return stdout;
  } catch (error) {
    if (error?.code === 63) {
      throw fail("官方规范压缩包超过 25 MB 限制，请手动下载后上传。", 413);
    }
    throw fail("下载 3GPP 官方规范包失败，请稍后重试或手动上传。", 502);
  }
}

function extractMainDocxFromZip(zipBuffer, spec) {
  let zip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw fail("官方规范压缩包解析失败。", 502);
  }
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const docxEntries = entries.filter((entry) => {
    const base = path.posix.basename(entry.entryName.replace(/\\/g, "/"));
    return /\.docx$/i.test(base) && !base.startsWith("~$");
  });

  if (!docxEntries.length) {
    const hasLegacyDoc = entries.some((entry) =>
      /\.doc$/i.test(path.posix.basename(entry.entryName.replace(/\\/g, "/")))
    );
    if (hasLegacyDoc) {
      throw fail(
        "该版本官方压缩包仅包含旧版 .doc 文件，请手动下载并另存为 .docx 后上传。",
        422
      );
    }
    throw fail("官方规范压缩包内未找到 .docx 文档。", 422);
  }

  const compactSpec = `${spec.series}${spec.item}`;
  docxEntries.sort((a, b) => {
    const aName = path.posix.basename(a.entryName.replace(/\\/g, "/"));
    const bName = path.posix.basename(b.entryName.replace(/\\/g, "/"));
    const aMatch = aName.toLowerCase().includes(compactSpec) ? 1 : 0;
    const bMatch = bName.toLowerCase().includes(compactSpec) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return (b.header?.size || 0) - (a.header?.size || 0);
  });

  const target = docxEntries[0];
  const docxBuffer = target.getData();
  if (docxBuffer.byteLength > MAX_DOCX_BYTES) {
    throw fail("解压后的规范 Word 超过 20 MB 限制，请手动上传。", 413);
  }
  return {
    name: path.posix.basename(target.entryName.replace(/\\/g, "/")),
    buffer: docxBuffer,
  };
}

function filterReleaseEntries(entries, major) {
  return entries
    .filter(
      (entry) => Number(String(entry.version || "").split(".")[0]) === major
    )
    .sort((a, b) => compareVersionsDesc(a.version, b.version));
}

async function listOfficialBaselineVersions(rawSpec, rawRelease, options = {}) {
  const spec = parseSpecInput(rawSpec);
  const release = parseReleaseInput(rawRelease);
  const archiveDir = `https://www.3gpp.org/ftp/Specs/archive/${spec.series}_series/${spec.id}/`;
  const readDir = options.fetchDirectory || fetchArchiveDirectory;
  const html = await readDir(archiveDir, options.signal);
  const allEntries = parseThreeGppArchiveHtml(html, archiveDir, spec);
  const releaseEntries = filterReleaseEntries(allEntries, release.major);

  if (!releaseEntries.length) {
    throw fail(
      `3GPP 官方归档中未找到 TS ${spec.id} 的 ${release.label} 正式版本。`,
      404
    );
  }

  return {
    spec: spec.id,
    release: release.label,
    archiveDir,
    versions: releaseEntries.map((item) => ({
      version: item.version,
      date: item.date || "",
      zipName: item.zipName,
      zipSize: item.zipSize || "",
    })),
    latest: releaseEntries[0],
  };
}

async function downloadOfficialBaselineDocx(
  rawSpec,
  rawRelease,
  rawVersion,
  options = {}
) {
  const spec = parseSpecInput(rawSpec);
  const release = parseReleaseInput(rawRelease);
  const requestedVersion = parseOptionalVersion(rawVersion);
  const archiveDir = `https://www.3gpp.org/ftp/Specs/archive/${spec.series}_series/${spec.id}/`;
  const readDir = options.fetchDirectory || fetchArchiveDirectory;
  const readZip = options.fetchZip || fetchArchiveZipBuffer;

  const html = await readDir(archiveDir, options.signal);
  const allEntries = parseThreeGppArchiveHtml(html, archiveDir, spec);
  const releaseEntries = filterReleaseEntries(allEntries, release.major);

  if (!releaseEntries.length) {
    throw fail(
      `3GPP 官方归档中未找到 TS ${spec.id} 的 ${release.label} 正式版本。`,
      404
    );
  }

  const targetEntry = requestedVersion
    ? releaseEntries.find((item) => item.version === requestedVersion)
    : releaseEntries[0];
  if (!targetEntry) {
    throw fail(
      `3GPP 官方归档中未找到 TS ${spec.id} V${requestedVersion}。`,
      404
    );
  }

  const zipBuffer = await readZip(targetEntry.zipUrl, options.signal);
  const { name, buffer } = extractMainDocxFromZip(zipBuffer, spec);

  return {
    name,
    spec: spec.id,
    release: release.label,
    version: targetEntry.version,
    zipName: targetEntry.zipName,
    source: targetEntry.zipUrl,
    fetchedAt: new Date().toISOString(),
    content: buffer.toString("base64"),
  };
}

module.exports = {
  parseSpecInput,
  parseReleaseInput,
  parseOptionalVersion,
  extractMainDocxFromZip,
  listOfficialBaselineVersions,
  downloadOfficialBaselineDocx,
};
