const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const AdmZip = require("adm-zip");
const {
  USER_AGENT,
  TEMP_PREFIX,
  invalid,
  getConfig,
  assertOfficialZipUrl,
} = require("./configAndSigning.ts");
const {
  assertAllowedThreeGppUrl,
  getMirrorConfig,
  localFileForUrl,
} = require("../threeGppSources");

const execFileAsync = promisify(execFile);

function resolveTargetUrl(
  value: string,
  allowAnyFtp = false
): { url: string; isMirror: boolean } {
  if (!allowAnyFtp) {
    return { url: assertOfficialZipUrl(value), isMirror: false };
  }
  return assertAllowedThreeGppUrl(value);
}

function mirrorCurlFlags(isMirror: boolean): string[] {
  const cfg = getMirrorConfig();
  if (isMirror) {
    const flags = ["--noproxy", "*"];
    if (cfg.mirrorInsecure) flags.push("-k");
    return flags;
  }
  return cfg.proxyUrl ? ["--proxy", cfg.proxyUrl] : [];
}

export interface ZipEntryInfo {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset?: number;
}

function parseHeadHeaders(rawHeaders: unknown): {
  contentLength: number;
  acceptRanges: boolean;
} {
  const blocks = String(rawHeaders || "")
    .trim()
    .split(/\r?\n\r?\n/);
  const last = blocks[blocks.length - 1] || "";
  let contentLength = 0;
  let acceptRanges = false;
  for (const line of last.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "content-length") {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) contentLength = n;
    } else if (key === "accept-ranges") {
      if (val.toLowerCase().includes("bytes")) acceptRanges = true;
    }
  }
  return { contentLength, acceptRanges };
}

function parseEndOfCentralDirectory(
  tailBuf: Buffer,
  totalSize: number
): { cdOffset: number; cdSize: number } {
  let eocdPos = -1;
  for (let i = tailBuf.length - 22; i >= 0; i--) {
    if (tailBuf.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0)
    throw invalid("无法解析 3GPP ZIP 文件目录结构，请直接下载原包。", 502);

  let cdSize = tailBuf.readUInt32LE(eocdPos + 12);
  let cdOffset = tailBuf.readUInt32LE(eocdPos + 16);

  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    if (eocdPos >= 20 && tailBuf.readUInt32LE(eocdPos - 20) === 0x07064b50) {
      const zip64Offset = Number(tailBuf.readBigUInt64LE(eocdPos - 12));
      const tailStart = totalSize - tailBuf.length;
      const localZip64 = zip64Offset - tailStart;
      if (
        localZip64 >= 0 &&
        localZip64 + 56 <= tailBuf.length &&
        tailBuf.readUInt32LE(localZip64) === 0x06064b50
      ) {
        cdSize = Number(tailBuf.readBigUInt64LE(localZip64 + 40));
        cdOffset = Number(tailBuf.readBigUInt64LE(localZip64 + 48));
      }
    }
  }

  if (
    !Number.isFinite(cdSize) ||
    !Number.isFinite(cdOffset) ||
    cdSize <= 0 ||
    cdSize > 8 * 1024 * 1024 ||
    cdOffset < 0 ||
    cdOffset + cdSize > totalSize
  )
    throw invalid("3GPP ZIP 目录信息异常，请直接下载原包。", 502);

  return { cdOffset, cdSize };
}

function parseCentralDirectoryEntries(cdBuf: Buffer): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = [];
  let pos = 0;
  while (pos + 46 <= cdBuf.length && cdBuf.readUInt32LE(pos) === 0x02014b50) {
    const method = cdBuf.readUInt16LE(pos + 10);
    const crc32 = cdBuf.readUInt32LE(pos + 16);
    let compressedSize = cdBuf.readUInt32LE(pos + 20);
    let uncompressedSize = cdBuf.readUInt32LE(pos + 24);
    const nameLen = cdBuf.readUInt16LE(pos + 28);
    const extraLen = cdBuf.readUInt16LE(pos + 30);
    const commentLen = cdBuf.readUInt16LE(pos + 32);
    let localHeaderOffset = cdBuf.readUInt32LE(pos + 42);

    const nameEnd = pos + 46 + nameLen;
    if (nameEnd + extraLen + commentLen > cdBuf.length) break;
    const rawName = cdBuf.subarray(pos + 46, nameEnd).toString("utf8");
    const extraBuf = cdBuf.subarray(nameEnd, nameEnd + extraLen);

    if (
      uncompressedSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      let ep = 0;
      while (ep + 4 <= extraBuf.length) {
        const headerId = extraBuf.readUInt16LE(ep);
        const dataSize = extraBuf.readUInt16LE(ep + 2);
        if (headerId === 0x0001 && ep + 4 + dataSize <= extraBuf.length) {
          let dp = ep + 4;
          if (uncompressedSize === 0xffffffff && dp + 8 <= ep + 4 + dataSize) {
            uncompressedSize = Number(extraBuf.readBigUInt64LE(dp));
            dp += 8;
          }
          if (compressedSize === 0xffffffff && dp + 8 <= ep + 4 + dataSize) {
            compressedSize = Number(extraBuf.readBigUInt64LE(dp));
            dp += 8;
          }
          if (localHeaderOffset === 0xffffffff && dp + 8 <= ep + 4 + dataSize) {
            localHeaderOffset = Number(extraBuf.readBigUInt64LE(dp));
          }
          break;
        }
        ep += 4 + dataSize;
      }
    }

    pos = nameEnd + extraLen + commentLen;
    const normalized = rawName.replace(/\\/g, "/");
    const base = path.posix.basename(normalized);
    if (
      !normalized ||
      normalized.endsWith("/") ||
      normalized.startsWith("__MACOSX/") ||
      base.startsWith("~$") ||
      base.startsWith("._")
    )
      continue;

    entries.push({
      name: normalized,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
  }
  return entries;
}

function classifyCurlError(
  err: { code?: unknown; stderr?: unknown; message?: unknown } | null,
  action = "下载该 Word 文档"
) {
  const code = Number(err?.code);
  const stderr = String(err?.stderr || err?.message || "");
  if (code === 28 || /timed?\s*out/i.test(stderr)) {
    return invalid(
      `从 3GPP 官网${action}超时，请重试或直接下载 3GPP 原包。`,
      504
    );
  }
  if (code === 22) {
    return invalid(
      `3GPP 官网返回异常响应，无法${action}，请稍后重试或直接下载原包。`,
      502
    );
  }
  if ([6, 7, 18, 35, 52, 55, 56].includes(code)) {
    return invalid(
      `从 3GPP 官网${action}时网络连接中断，请点击重试或直接下载 3GPP 原包。`,
      502
    );
  }
  return invalid(
    `从 3GPP 官网${action}失败（curl ${Number.isFinite(code) ? code : "error"}），请重试或直接下载 3GPP 原包。`,
    502
  );
}

async function curlBuffer(
  args: string[],
  maxBuffer = 16 * 1024 * 1024,
  signal?: AbortSignal
): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync("curl", args, {
      encoding: "buffer",
      signal,
      maxBuffer,
    });
    return stdout as Buffer;
  } catch (err: unknown) {
    throw classifyCurlError(
      err as { code?: unknown; stderr?: unknown; message?: unknown },
      "读取压缩包目录"
    );
  }
}

function readZipEntries(zipPath: string): ZipEntryInfo[] {
  const zip = new AdmZip(zipPath);
  return zip
    .getEntries()
    .filter((e: { entryName: string; isDirectory: boolean }) => {
      const normalized = e.entryName.replace(/\\/g, "/");
      const base = path.posix.basename(normalized);
      return (
        !e.isDirectory &&
        !normalized.startsWith("__MACOSX/") &&
        !base.startsWith("~$") &&
        !base.startsWith("._")
      );
    })
    .map(
      (e: {
        entryName: string;
        header: {
          method: number;
          crc: number;
          compressedSize: number;
          size: number;
        };
      }) => ({
        name: e.entryName.replace(/\\/g, "/"),
        method: e.header.method,
        crc32: e.header.crc,
        compressedSize: e.header.compressedSize,
        uncompressedSize: e.header.size,
      })
    );
}

async function inspectRemoteZip(
  zipUrl: string,
  options: { allowAnyFtp?: boolean; signal?: AbortSignal } = {}
): Promise<{
  totalSize: number;
  acceptRanges: boolean;
  entries: ZipEntryInfo[];
}> {
  const { url: safeUrl, isMirror } = resolveTargetUrl(
    zipUrl,
    Boolean(options?.allowAnyFtp)
  );
  const local = options.allowAnyFtp && (await localFileForUrl(safeUrl));
  if (local) {
    if (local.size > getConfig().wordMaxBytes * 3)
      throw invalid("压缩包过大，请下载原包。", 413);
    return {
      totalSize: local.size,
      acceptRanges: false,
      entries: readZipEntries(local.localPath),
    };
  }
  const netFlags = [
    "--globoff",
    "--max-redirs",
    "0",
    ...mirrorCurlFlags(isMirror),
  ];
  let headOut: string;
  try {
    headOut = (
      await execFileAsync(
        "curl",
        [
          "-fsSIL",
          "--connect-timeout",
          "15",
          "--max-time",
          "25",
          "--retry",
          "2",
          "--retry-delay",
          "1",
          "-A",
          USER_AGENT,
          ...netFlags,
          safeUrl,
        ],
        { maxBuffer: 512 * 1024, signal: options.signal }
      )
    ).stdout as string;
  } catch (err: unknown) {
    throw classifyCurlError(
      err as { code?: unknown; stderr?: unknown; message?: unknown },
      "读取压缩包信息"
    );
  }
  const { contentLength: totalSize, acceptRanges } = parseHeadHeaders(headOut);

  if (acceptRanges && totalSize >= 22) {
    const tailLen = Math.min(totalSize, 65536);
    const tailStart = totalSize - tailLen;
    const tailBuf = await curlBuffer(
      [
        "-fsSL",
        "--connect-timeout",
        "15",
        "--max-time",
        "30",
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "-A",
        USER_AGENT,
        ...netFlags,
        "-r",
        `${tailStart}-${totalSize - 1}`,
        safeUrl,
      ],
      tailLen + 65536,
      options.signal
    );
    const { cdOffset, cdSize } = parseEndOfCentralDirectory(tailBuf, totalSize);
    const cdBuf = await curlBuffer(
      [
        "-fsSL",
        "--connect-timeout",
        "15",
        "--max-time",
        "30",
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "-A",
        USER_AGENT,
        ...netFlags,
        "-r",
        `${cdOffset}-${cdOffset + cdSize - 1}`,
        safeUrl,
      ],
      cdSize + 65536,
      options.signal
    );
    return {
      totalSize,
      acceptRanges: true,
      entries: parseCentralDirectoryEntries(cdBuf),
    };
  }

  const { wordMaxBytes } = getConfig();
  if (totalSize > wordMaxBytes * 3)
    throw invalid(
      "服务器不支持按分片读取该大文件，请直接下载 3GPP 原包。",
      413
    );

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  try {
    const zipPath = path.join(tmpDir, "archive.zip");
    try {
      await execFileAsync(
        "curl",
        [
          "-fsSL",
          "--connect-timeout",
          "15",
          "--max-time",
          "90",
          "--retry",
          "2",
          "--retry-delay",
          "1",
          "-A",
          USER_AGENT,
          ...netFlags,
          "--max-filesize",
          String(wordMaxBytes * 3),
          "-o",
          zipPath,
          safeUrl,
        ],
        { maxBuffer: 1024 * 1024, signal: options.signal }
      );
    } catch (err: unknown) {
      throw classifyCurlError(
        err as { code?: unknown; stderr?: unknown; message?: unknown },
        "下载压缩包"
      );
    }
    const entries = readZipEntries(zipPath);
    return { totalSize, acceptRanges: false, entries };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function watchFileSize(
  filePath: string,
  intervalMs: number,
  onSize: (size: number) => void
): () => void {
  let active = true;
  const timer = setInterval(async () => {
    if (!active) return;
    try {
      const st = await fs.stat(filePath);
      if (active && st.isFile()) onSize(st.size);
    } catch {
      // File may not exist yet.
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => {
    active = false;
    clearInterval(timer);
  };
}

async function extractRemoteZipEntry(
  zipUrl: string,
  entry: ZipEntryInfo,
  outputPath: string,
  tmpDir: string,
  onProgress?: (progress: {
    downloadedBytes: number;
    downloadTotalBytes: number;
  }) => void,
  options: { allowAnyFtp?: boolean; signal?: AbortSignal } = {}
): Promise<number> {
  const { url: safeUrl, isMirror } = resolveTargetUrl(
    zipUrl,
    Boolean(options?.allowAnyFtp)
  );
  const netFlags = [
    "--globoff",
    "--max-redirs",
    "0",
    ...mirrorCurlFlags(isMirror),
  ];
  const { wordMaxBytes } = getConfig();
  if (entry.uncompressedSize > wordMaxBytes)
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
      413
    );

  const local = options.allowAnyFtp && (await localFileForUrl(safeUrl));
  if (local) {
    if (local.size > wordMaxBytes * 3)
      throw invalid("压缩包过大，请下载原包。", 413);
    const file = new AdmZip(local.localPath)
      .getEntries()
      .find(
        (e: { entryName: string }) =>
          e.entryName.replace(/\\/g, "/") === entry.name
      );
    if (!file || file.header.size > wordMaxBytes)
      throw invalid("无法提取此文件，请下载原包。", 422);
    const data = file.getData();
    await fs.writeFile(outputPath, data);
    return data.length;
  }
  const canRange =
    typeof entry.localHeaderOffset === "number" &&
    entry.localHeaderOffset >= 0 &&
    typeof entry.compressedSize === "number" &&
    entry.compressedSize >= 0;

  if (canRange && entry.localHeaderOffset !== undefined) {
    const localHeaderOffset = entry.localHeaderOffset;
    const fetchSlice = async (extraAllowance: number): Promise<Buffer> => {
      const span =
        30 +
        Buffer.byteLength(entry.name, "utf8") +
        extraAllowance +
        entry.compressedSize;
      if (span > wordMaxBytes + 131072)
        throw invalid("文件超过提取上限，请下载原包。", 413);
      const start = localHeaderOffset;
      const end = start + span - 1;
      const slicePath = path.join(tmpDir, "slice.bin");
      const stopWatch =
        typeof onProgress === "function"
          ? watchFileSize(slicePath, 400, (bytes) =>
              onProgress({
                downloadedBytes: Math.min(bytes, entry.compressedSize),
                downloadTotalBytes: entry.compressedSize,
              })
            )
          : null;
      try {
        await execFileAsync(
          "curl",
          [
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "90",
            "--retry",
            "2",
            "--retry-delay",
            "1",
            "-A",
            USER_AGENT,
            ...netFlags,
            "-r",
            `${start}-${end}`,
            "--max-filesize",
            String(span),
            "-o",
            slicePath,
            safeUrl,
          ],
          { maxBuffer: 1024 * 1024, signal: options.signal }
        );
        if (typeof onProgress === "function") {
          onProgress({
            downloadedBytes: entry.compressedSize,
            downloadTotalBytes: entry.compressedSize,
          });
        }
      } catch (err: unknown) {
        throw classifyCurlError(
          err as { code?: unknown; stderr?: unknown; message?: unknown },
          "下载该 Word 文档"
        );
      } finally {
        if (stopWatch) stopWatch();
      }
      return fs.readFile(slicePath);
    };

    let sliceBuf = await fetchSlice(4096);
    if (sliceBuf.length < 30 || sliceBuf.readUInt32LE(0) !== 0x04034b50)
      throw invalid("读取 ZIP 分片失败，请重试或直接下载 3GPP 原包。", 502);

    const lhNameLen = sliceBuf.readUInt16LE(26);
    const lhExtraLen = sliceBuf.readUInt16LE(28);
    const dataStart = 30 + lhNameLen + lhExtraLen;
    if (dataStart + entry.compressedSize > sliceBuf.length) {
      sliceBuf = await fetchSlice(lhExtraLen + 64);
    }
    const compressed = sliceBuf.subarray(
      dataStart,
      dataStart + entry.compressedSize
    );
    if (compressed.length !== entry.compressedSize)
      throw invalid("下载的 Word 文档数据不完整，请稍后重试。", 502);

    let raw: Buffer;
    if (entry.method === 0) {
      raw = compressed;
    } else if (entry.method === 8) {
      try {
        raw = zlib.inflateRawSync(compressed, {
          maxOutputLength: wordMaxBytes,
        });
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE") {
          throw invalid(
            `该 Word 文档解压后超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 上限，请直接下载 3GPP 原包。`,
            413
          );
        }
        throw invalid("解压 3GPP Word 文档失败，请直接下载原包。", 502);
      }
    } else {
      throw invalid("暂不支持该压缩格式的文档，请直接下载 3GPP 原包。", 422);
    }

    if (raw.length > wordMaxBytes)
      throw invalid(
        `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
        413
      );
    if (
      typeof entry.crc32 === "number" &&
      entry.crc32 > 0 &&
      typeof zlib.crc32 === "function" &&
      zlib.crc32(raw) >>> 0 !== entry.crc32 >>> 0
    )
      throw invalid("下载的 Word 文档校验失败，请重试。", 502);

    await fs.writeFile(outputPath, raw);
    return raw.length;
  }

  const zipPath = path.join(tmpDir, "archive.zip");
  try {
    await execFileAsync(
      "curl",
      [
        "-fsSL",
        "--connect-timeout",
        "15",
        "--max-time",
        "90",
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "-A",
        USER_AGENT,
        ...netFlags,
        "--max-filesize",
        String(wordMaxBytes * 3),
        "-o",
        zipPath,
        safeUrl,
      ],
      { maxBuffer: 1024 * 1024, signal: options.signal }
    );
  } catch (err: unknown) {
    throw classifyCurlError(
      err as { code?: unknown; stderr?: unknown; message?: unknown },
      "下载 3GPP 压缩包"
    );
  }
  const zip = new AdmZip(zipPath);
  const match = zip
    .getEntries()
    .find(
      (e: { entryName: string }) =>
        e.entryName.replace(/\\/g, "/") === entry.name
    );
  if (!match) throw invalid("压缩包中未找到目标文档。", 404);
  if (match.header.size > wordMaxBytes)
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
      413
    );
  const raw: Buffer = match.getData();
  if (raw.length > wordMaxBytes)
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
      413
    );
  await fs.writeFile(outputPath, raw);
  return raw.length;
}

async function extractMemberBuffer({
  zipUrl,
  entry,
  allowAnyFtp = true,
  signal,
}: {
  zipUrl: string;
  entry: ZipEntryInfo;
  allowAnyFtp?: boolean;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  try {
    const ext = path.posix.extname(entry.name).toLowerCase() || ".bin";
    const outPath = path.join(tmpDir, `member${ext}`);
    await extractRemoteZipEntry(zipUrl, entry, outPath, tmpDir, undefined, {
      allowAnyFtp,
      signal,
    });
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadDirectWordFile(
  directUrl: string,
  outputPath: string
): Promise<number> {
  const { url: safeUrl, isMirror } = resolveTargetUrl(directUrl, true);
  const local = await localFileForUrl(safeUrl);
  if (local) {
    if (local.size > getConfig().wordMaxBytes)
      throw invalid("文件超过预览上限。", 413);
    await fs.copyFile(local.localPath, outputPath);
    return local.size;
  }
  const netFlags = [
    "--globoff",
    "--max-redirs",
    "0",
    ...mirrorCurlFlags(isMirror),
  ];
  try {
    await execFileAsync(
      "curl",
      [
        "-fsSL",
        "--connect-timeout",
        "15",
        "--max-time",
        "90",
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "-A",
        USER_AGENT,
        ...netFlags,
        "--max-filesize",
        String(getConfig().wordMaxBytes),
        "-o",
        outputPath,
        safeUrl,
      ],
      { maxBuffer: 1024 * 1024 }
    );
  } catch (err: unknown) {
    throw classifyCurlError(
      err as { code?: unknown; stderr?: unknown; message?: unknown },
      "下载该 Word 文档"
    );
  }
  const stat = await fs.stat(outputPath);
  const { wordMaxBytes } = getConfig();
  if (stat.size > wordMaxBytes) {
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载原文件。`,
      413
    );
  }
  return stat.size;
}

module.exports = {
  parseHeadHeaders,
  parseEndOfCentralDirectory,
  parseCentralDirectoryEntries,
  classifyCurlError,
  curlBuffer,
  inspectRemoteZip,
  watchFileSize,
  extractRemoteZipEntry,
  extractMemberBuffer,
  downloadDirectWordFile,
};
