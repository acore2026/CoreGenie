const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const AdmZip = require("adm-zip");

const execFileAsync = promisify(execFile);

const USER_AGENT = "Mozilla/5.0 AnythingLLM-Agent/1.0";
const TEMP_PREFIX = "protocol-finder-job-";
const STALE_TEMP_MS = 60 * 60 * 1000;
const JOB_RETENTION_MS = 10 * 60 * 1000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const jobs = new Map();
const queue = [];
let activeCount = 0;
let maintenanceTimer = null;
let maintenanceStarted = false;

function invalid(publicMessage, status = 400) {
  return Object.assign(new Error(publicMessage), { publicMessage, status });
}

function positiveNumber(raw, fallback, min = 1) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function getConfig() {
  const ttlDays = positiveNumber(
    process.env.PROTOCOL_FINDER_PDF_TTL_DAYS,
    14,
    0.001
  );
  const maxMb = positiveNumber(
    process.env.PROTOCOL_FINDER_PDF_MAX_MB,
    2048,
    0.01
  );
  const wordMaxMb = positiveNumber(
    process.env.PROTOCOL_FINDER_WORD_MAX_MB,
    30,
    0.1
  );
  const convertTimeoutMs = positiveNumber(
    process.env.PROTOCOL_FINDER_CONVERT_TIMEOUT_MS,
    120000,
    5000
  );
  const maxConcurrency = Math.min(
    8,
    Math.floor(
      positiveNumber(process.env.PROTOCOL_FINDER_MAX_CONCURRENCY, 2, 1)
    )
  );
  const previewTtlSeconds = positiveNumber(
    process.env.PROTOCOL_FINDER_PREVIEW_TTL_SECONDS,
    1800,
    60
  );
  return {
    ttlMs: ttlDays * 24 * 60 * 60 * 1000,
    maxBytes: Math.floor(maxMb * 1024 * 1024),
    wordMaxBytes: Math.floor(wordMaxMb * 1024 * 1024),
    convertTimeoutMs,
    maxConcurrency,
    previewTtlSeconds,
    sofficeBin: process.env.PROTOCOL_FINDER_SOFFICE_BIN || "soffice",
  };
}

function storageRoot() {
  return path.join(
    process.env.STORAGE_DIR || path.join(__dirname, "../storage"),
    "protocol-finder"
  );
}

function pdfCacheDir() {
  return path.join(storageRoot(), "pdfs");
}

function assertOfficialZipUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalid("无效的 3GPP 文档地址。", 400);
  }
  if (
    url.origin !== "https://www.3gpp.org" ||
    !url.pathname.startsWith("/ftp/Specs/") ||
    url.username ||
    url.password
  )
    throw invalid("只允许从 3GPP 官方规范目录读取文档。", 400);
  url.hash = "";
  return url.href;
}

function pdfCacheKey(archiveId, zipName, memberName) {
  return crypto
    .createHash("sha256")
    .update(`${archiveId}\n${zipName}\n${memberName}`)
    .digest("hex");
}

function displayPdfFilename(memberName) {
  const base = path.posix.basename(
    String(memberName || "").replace(/\\/g, "/")
  );
  const replaced = /\.(docx?|rtf|pdf)$/i.test(base)
    ? base.replace(/\.(docx?|rtf|pdf)$/i, ".pdf")
    : `${base || "document"}.pdf`;
  const cleaned = replaced.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 140);
  return cleaned.endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

async function getSigningSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return crypto
      .createHash("sha256")
      .update(`protocol-finder-pdf:${process.env.JWT_SECRET}`)
      .digest();
  }
  const dir = storageRoot();
  await fs.mkdir(dir, { recursive: true });
  const keyFile = path.join(dir, ".signing-key");
  try {
    const existing = (await fs.readFile(keyFile, "utf8")).trim();
    if (/^[a-f0-9]{64}$/.test(existing)) return Buffer.from(existing, "hex");
  } catch {
    // Generate a persistent local key when JWT_SECRET is unset.
  }
  const fresh = crypto.randomBytes(32).toString("hex");
  const tmp = `${keyFile}.${crypto.randomUUID()}`;
  await fs.writeFile(tmp, fresh, { mode: 0o600 });
  try {
    await fs.rename(tmp, keyFile);
  } catch {
    await fs.rm(tmp, { force: true });
  }
  return Buffer.from(fresh, "hex");
}

async function signPdfPath({ hash, filename, now = Date.now() }) {
  const { previewTtlSeconds } = getConfig();
  const safeName = displayPdfFilename(filename);
  const exp = now + previewTtlSeconds * 1000;
  const secret = await getSigningSecret();
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${hash}\n${safeName}\n${exp}`)
    .digest("base64url");
  return `/3gpp/protocol-finder/pdf/${hash}?name=${encodeURIComponent(safeName)}&exp=${exp}&sig=${sig}`;
}

async function verifySignedPdf({ hash, name, exp, sig, now = Date.now() }) {
  if (
    typeof hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(hash) ||
    typeof name !== "string" ||
    typeof sig !== "string"
  )
    throw invalid("无效的 PDF 预览链接。", 400);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < now)
    throw invalid("PDF 预览链接已过期，请返回页面重新打开。", 403);
  const safeName = displayPdfFilename(name);
  if (safeName !== name) throw invalid("无效的 PDF 文件名。", 400);

  const secret = await getSigningSecret();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${hash}\n${safeName}\n${expNum}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw invalid("PDF 预览链接校验失败。", 403);

  const filePath = path.join(pdfCacheDir(), `${hash}.pdf`);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw invalid("该 PDF 缓存已被清理或不存在，请返回页面重新生成。", 404);
  }
  if (!stat.isFile() || stat.size <= 0)
    throw invalid("该 PDF 缓存文件无效，请返回页面重新生成。", 404);

  const touch = new Date(now);
  await fs.utimes(filePath, touch, touch).catch(() => {});
  return { filePath, filename: safeName, size: stat.size };
}

async function getCachedPdfInfo(hash, filename, now = Date.now()) {
  const filePath = path.join(pdfCacheDir(), `${hash}.pdf`);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    const pdfPath = await signPdfPath({ hash, filename, now });
    return { size: stat.size, pdfPath, filePath };
  } catch {
    return null;
  }
}

function parseHeadHeaders(rawHeaders) {
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

function parseEndOfCentralDirectory(tailBuf, totalSize) {
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
    // ZIP64 EOCD locator sits 20 bytes before EOCD.
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

function parseCentralDirectoryEntries(cdBuf) {
  const entries = [];
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

function classifyCurlError(err, action = "下载该 Word 文档") {
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

async function curlBuffer(args, maxBuffer = 16 * 1024 * 1024) {
  try {
    const { stdout } = await execFileAsync("curl", args, {
      encoding: "buffer",
      maxBuffer,
    });
    return stdout;
  } catch (err) {
    throw classifyCurlError(err, "读取压缩包目录");
  }
}

async function inspectRemoteZip(zipUrl) {
  const safeUrl = assertOfficialZipUrl(zipUrl);
  let headOut;
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
          safeUrl,
        ],
        { maxBuffer: 512 * 1024 }
      )
    ).stdout;
  } catch (err) {
    throw classifyCurlError(err, "读取压缩包信息");
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
        "-r",
        `${tailStart}-${totalSize - 1}`,
        safeUrl,
      ],
      tailLen + 65536
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
        "-r",
        `${cdOffset}-${cdOffset + cdSize - 1}`,
        safeUrl,
      ],
      cdSize + 65536
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
          "-o",
          zipPath,
          safeUrl,
        ],
        { maxBuffer: 1024 * 1024 }
      );
    } catch (err) {
      throw classifyCurlError(err, "下载压缩包");
    }
    const zip = new AdmZip(zipPath);
    const entries = zip
      .getEntries()
      .filter((e) => {
        const normalized = e.entryName.replace(/\\/g, "/");
        const base = path.posix.basename(normalized);
        return (
          !e.isDirectory &&
          !normalized.startsWith("__MACOSX/") &&
          !base.startsWith("~$") &&
          !base.startsWith("._")
        );
      })
      .map((e) => ({
        name: e.entryName.replace(/\\/g, "/"),
        method: e.header.method,
        crc32: e.header.crc,
        compressedSize: e.header.compressedSize,
        uncompressedSize: e.header.size,
      }));
    return { totalSize, acceptRanges: false, entries };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractRemoteZipEntry(zipUrl, entry, outputPath, tmpDir) {
  const safeUrl = assertOfficialZipUrl(zipUrl);
  const { wordMaxBytes } = getConfig();
  if (entry.uncompressedSize > wordMaxBytes)
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
      413
    );

  const canRange =
    typeof entry.localHeaderOffset === "number" &&
    entry.localHeaderOffset >= 0 &&
    typeof entry.compressedSize === "number" &&
    entry.compressedSize >= 0;

  if (canRange) {
    const fetchSlice = async (extraAllowance) => {
      const span =
        30 +
        Buffer.byteLength(entry.name, "utf8") +
        extraAllowance +
        entry.compressedSize;
      const start = entry.localHeaderOffset;
      const end = start + span - 1;
      const slicePath = path.join(tmpDir, "slice.bin");
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
            "-r",
            `${start}-${end}`,
            "-o",
            slicePath,
            safeUrl,
          ],
          { maxBuffer: 1024 * 1024 }
        );
      } catch (err) {
        throw classifyCurlError(err, "下载该 Word 文档");
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

    let raw;
    if (entry.method === 0) {
      raw = compressed;
    } else if (entry.method === 8) {
      try {
        raw = zlib.inflateRawSync(compressed, {
          maxOutputLength: wordMaxBytes,
        });
      } catch (err) {
        if (err && err.code === "ERR_BUFFER_TOO_LARGE") {
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

  // Fallback: full archive download when server does not support HTTP Range.
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
        "-o",
        zipPath,
        safeUrl,
      ],
      { maxBuffer: 1024 * 1024 }
    );
  } catch (err) {
    throw classifyCurlError(err, "下载 3GPP 压缩包");
  }
  const zip = new AdmZip(zipPath);
  const match = zip
    .getEntries()
    .find((e) => e.entryName.replace(/\\/g, "/") === entry.name);
  if (!match) throw invalid("压缩包中未找到目标文档。", 404);
  if (match.header.size > wordMaxBytes)
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
      413
    );
  const raw = match.getData();
  if (raw.length > wordMaxBytes)
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
      413
    );
  await fs.writeFile(outputPath, raw);
  return raw.length;
}

async function moveFileAtomic(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmpTarget = path.join(
    path.dirname(target),
    `.tmp-${crypto.randomUUID()}.pdf`
  );
  await fs.copyFile(source, tmpTarget);
  try {
    await fs.rename(tmpTarget, target);
  } catch (err) {
    await fs.rm(tmpTarget, { force: true }).catch(() => {});
    throw err;
  }
}

async function convertWordToPdf(inputPath, outDir, profileDir) {
  const { convertTimeoutMs, sofficeBin } = getConfig();
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });
  const profileUri = `file://${profileDir.replace(/\\/g, "/")}`;

  let result;
  try {
    result = await execFileAsync(
      sofficeBin,
      [
        "--headless",
        "--norestore",
        "--nolockcheck",
        `-env:UserInstallation=${profileUri}`,
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        outDir,
        inputPath,
      ],
      {
        timeout: convertTimeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
      }
    );
  } catch (err) {
    if (err && err.code === "ENOENT")
      throw invalid(
        "服务器未安装 LibreOffice，暂无法将 Word 转为 PDF，请先下载 3GPP 原包。",
        503
      );
    if (err && (err.killed || err.signal === "SIGKILL"))
      throw invalid(
        `Word 转 PDF 超过 ${Math.round(convertTimeoutMs / 1000)} 秒未完成，建议直接下载 3GPP 原包。`,
        504
      );
    const detail = String(err?.stderr || err?.message || "").trim();
    throw invalid(
      detail
        ? `Word 转 PDF 失败：${detail.slice(0, 160)}`
        : "Word 转 PDF 失败，请稍后重试或直接下载 3GPP 原包。",
      500
    );
  }

  const expectedPdf = path.join(
    outDir,
    `${path.basename(inputPath, path.extname(inputPath))}.pdf`
  );
  let stat;
  try {
    stat = await fs.stat(expectedPdf);
  } catch {
    const detail = String(result?.stderr || "").trim();
    throw invalid(
      /could not be loaded/i.test(detail)
        ? "LibreOffice Writer 未安装或无法打开该 Word 文件，请检查服务器组件或直接下载原包。"
        : "LibreOffice 未生成 PDF 文件，请稍后重试或直接下载 3GPP 原包。",
      500
    );
  }
  if (!stat.isFile() || stat.size < 8)
    throw invalid("生成的 PDF 文件为空，请直接下载 3GPP 原包。", 500);

  const fh = await fs.open(expectedPdf, "r");
  try {
    const header = Buffer.alloc(5);
    await fh.read(header, 0, 5, 0);
    if (header.toString("ascii") !== "%PDF-")
      throw invalid("生成的 PDF 文件格式异常，请直接下载 3GPP 原包。", 500);
  } finally {
    await fh.close();
  }
  return expectedPdf;
}

async function cleanupStaleTempDirs(now = Date.now()) {
  let removed = 0;
  try {
    const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;
      const full = path.join(os.tmpdir(), entry.name);
      try {
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs >= STALE_TEMP_MS) {
          await fs.rm(full, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // Ignore racing removal.
      }
    }
  } catch {
    // Ignore tmpdir inspection error.
  }
  return removed;
}

async function prunePdfCache(now = Date.now()) {
  const { ttlMs, maxBytes } = getConfig();
  const dir = pdfCacheDir();
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { expiredRemoved: 0, lruRemoved: 0, remainingBytes: 0 };
  }

  let expiredRemoved = 0;
  let lruRemoved = 0;
  const kept = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }

    if (entry.name.startsWith(".tmp-")) {
      if (now - stat.mtimeMs >= STALE_TEMP_MS) {
        await fs.rm(full, { force: true }).catch(() => {});
      }
      continue;
    }

    if (!entry.name.endsWith(".pdf")) continue;

    if (now - stat.mtimeMs > ttlMs) {
      await fs.rm(full, { force: true }).catch(() => {});
      expiredRemoved++;
    } else {
      kept.push({ full, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }

  let totalBytes = kept.reduce((sum, item) => sum + item.size, 0);
  if (totalBytes > maxBytes) {
    const targetBytes = Math.floor(maxBytes * 0.8);
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of kept) {
      if (totalBytes <= targetBytes) break;
      await fs.rm(item.full, { force: true }).catch(() => {});
      totalBytes -= item.size;
      lruRemoved++;
    }
  }

  return { expiredRemoved, lruRemoved, remainingBytes: totalBytes };
}

function startCacheMaintenance() {
  if (maintenanceStarted) return;
  maintenanceStarted = true;
  cleanupStaleTempDirs().catch(() => {});
  prunePdfCache().catch(() => {});
  maintenanceTimer = setInterval(() => {
    cleanupStaleTempDirs().catch(() => {});
    prunePdfCache().catch(() => {});
  }, PRUNE_INTERVAL_MS);
  if (typeof maintenanceTimer.unref === "function") maintenanceTimer.unref();
}

function pruneOldJobRecords(now = Date.now()) {
  for (const [key, job] of jobs.entries()) {
    if (
      (job.status === "ready" || job.status === "failed") &&
      now - job.updatedAt > JOB_RETENTION_MS
    ) {
      jobs.delete(key);
    }
  }
}

function pumpQueue() {
  const { maxConcurrency } = getConfig();
  while (activeCount < maxConcurrency && queue.length > 0) {
    const task = queue.shift();
    activeCount++;
    runJob(task).finally(() => {
      activeCount--;
      pumpQueue();
    });
  }
}

async function runJob({ hash, zipUrl, entry }) {
  const job = jobs.get(hash);
  if (!job) return;
  let tmpDir = null;
  try {
    job.status = "downloading";
    job.updatedAt = Date.now();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    const ext = path.posix.extname(entry.name).toLowerCase() || ".docx";
    const inputPath = path.join(tmpDir, `source${ext}`);
    await extractRemoteZipEntry(zipUrl, entry, inputPath, tmpDir);

    job.status = "converting";
    job.updatedAt = Date.now();
    const outDir = path.join(tmpDir, "out");
    const profileDir = path.join(tmpDir, "profile");
    const generatedPdf = await convertWordToPdf(inputPath, outDir, profileDir);

    const targetPath = path.join(pdfCacheDir(), `${hash}.pdf`);
    await moveFileAtomic(generatedPdf, targetPath);
    const stat = await fs.stat(targetPath);

    job.status = "ready";
    job.size = stat.size;
    job.error = null;
    job.updatedAt = Date.now();

    prunePdfCache().catch(() => {});
  } catch (err) {
    console.warn("[protocol-finder] convert failed:", {
      hash,
      member: entry?.name,
      code: err?.code,
      message: err?.publicMessage || err?.message,
    });
    job.status = "failed";
    job.error =
      err?.publicMessage ||
      "文档下载或转换失败，请稍后重试或直接下载 3GPP 原包。";
    job.updatedAt = Date.now();
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function getJobView(hash, filename) {
  const cached = await getCachedPdfInfo(hash, filename);
  if (cached) {
    return {
      status: "ready",
      hash,
      filename: displayPdfFilename(filename),
      pdfPath: cached.pdfPath,
      size: cached.size,
      cached: true,
    };
  }
  const job = jobs.get(hash);
  if (!job) {
    return {
      status: "idle",
      hash,
      filename: displayPdfFilename(filename),
      cached: false,
    };
  }
  if (job.status === "ready") {
    // Edge case: job finished but cache file was evicted before read.
    jobs.delete(hash);
    return {
      status: "idle",
      hash,
      filename: displayPdfFilename(filename),
      cached: false,
    };
  }
  return {
    status: job.status,
    hash,
    filename: job.filename,
    error: job.error || undefined,
    cached: false,
  };
}

async function startConversion({ archiveId, zipName, zipUrl, entry }) {
  pruneOldJobRecords();
  const safeUrl = assertOfficialZipUrl(zipUrl);
  const { wordMaxBytes } = getConfig();
  if (!/\.(docx?|rtf)$/i.test(entry.name))
    throw invalid("该文件不是 Word 文档，请直接下载 3GPP 原包。", 422);
  if (entry.uncompressedSize > wordMaxBytes)
    throw invalid(
      `该 Word 文档超过 ${Math.round(wordMaxBytes / 1024 / 1024)} MB 转换上限，请直接下载 3GPP 原包。`,
      413
    );

  const hash = pdfCacheKey(archiveId, zipName, entry.name);
  const filename = displayPdfFilename(entry.name);

  const cached = await getCachedPdfInfo(hash, filename);
  if (cached) {
    const now = new Date();
    await fs.utimes(cached.filePath, now, now).catch(() => {});
    return {
      status: "ready",
      hash,
      filename,
      pdfPath: cached.pdfPath,
      size: cached.size,
      cached: true,
    };
  }

  const existing = jobs.get(hash);
  if (
    existing &&
    (existing.status === "queued" ||
      existing.status === "downloading" ||
      existing.status === "converting")
  ) {
    return {
      status: existing.status,
      hash,
      filename: existing.filename,
      cached: false,
    };
  }

  const job = {
    status: "queued",
    hash,
    filename,
    error: null,
    size: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(hash, job);
  queue.push({ hash, filename, zipUrl: safeUrl, entry });
  pumpQueue();

  return {
    status: job.status,
    hash,
    filename,
    cached: false,
  };
}

function resetJobsForTest() {
  jobs.clear();
  queue.length = 0;
  activeCount = 0;
}

module.exports = {
  getConfig,
  storageRoot,
  pdfCacheDir,
  assertOfficialZipUrl,
  pdfCacheKey,
  displayPdfFilename,
  signPdfPath,
  verifySignedPdf,
  getCachedPdfInfo,
  parseHeadHeaders,
  parseEndOfCentralDirectory,
  parseCentralDirectoryEntries,
  inspectRemoteZip,
  extractRemoteZipEntry,
  convertWordToPdf,
  cleanupStaleTempDirs,
  prunePdfCache,
  startCacheMaintenance,
  startConversion,
  getJobView,
  resetJobsForTest,
};
