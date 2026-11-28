const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const USER_AGENT = "Mozilla/5.0 AnythingLLM-Agent/1.0";
const TEMP_PREFIX = "protocol-finder-job-";
const STALE_TEMP_MS = 60 * 60 * 1000;
const JOB_RETENTION_MS = 10 * 60 * 1000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface ProtocolFinderError extends Error {
  publicMessage: string;
  status: number;
}

export interface ProtocolFinderConfig {
  ttlMs: number;
  maxBytes: number;
  wordMaxBytes: number;
  convertTimeoutMs: number;
  maxConcurrency: number;
  previewTtlSeconds: number;
  sofficeBin: string;
}

function invalid(publicMessage: string, status = 400): ProtocolFinderError {
  return Object.assign(new Error(publicMessage), {
    publicMessage,
    status,
  }) as ProtocolFinderError;
}

function positiveNumber(raw: unknown, fallback: number, min = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function getConfig(): ProtocolFinderConfig {
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
    300000,
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

function storageRoot(): string {
  return path.join(
    process.env.STORAGE_DIR || path.join(__dirname, "../../storage"),
    "protocol-finder"
  );
}

function pdfCacheDir(): string {
  return path.join(storageRoot(), "pdfs");
}

function assertOfficialZipUrl(value: string): string {
  let url: URL;
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

function pdfCacheKey(
  archiveId: string,
  zipName: string,
  memberName: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${archiveId}\n${zipName}\n${memberName}`)
    .digest("hex");
}

function displayPdfFilename(memberName: string): string {
  const base = path.posix.basename(
    String(memberName || "").replace(/\\/g, "/")
  );
  const replaced = /\.(docx?|rtf|pdf)$/i.test(base)
    ? base.replace(/\.(docx?|rtf|pdf)$/i, ".pdf")
    : `${base || "document"}.pdf`;
  const cleaned = replaced.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 140);
  return cleaned.endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

async function getSigningSecret(): Promise<Buffer> {
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

async function signPdfPath({
  hash,
  filename,
  now = Date.now(),
}: {
  hash: string;
  filename: string;
  now?: number;
}): Promise<string> {
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

async function verifySignedPdf({
  hash,
  name,
  exp,
  sig,
  now = Date.now(),
}: {
  hash: unknown;
  name: unknown;
  exp: unknown;
  sig: unknown;
  now?: number;
}): Promise<{ filePath: string; filename: string; size: number }> {
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

async function getCachedPdfInfo(
  hash: string,
  filename: string,
  now = Date.now()
): Promise<{ size: number; pdfPath: string; filePath: string } | null> {
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

module.exports = {
  USER_AGENT,
  TEMP_PREFIX,
  STALE_TEMP_MS,
  JOB_RETENTION_MS,
  PRUNE_INTERVAL_MS,
  invalid,
  positiveNumber,
  getConfig,
  storageRoot,
  pdfCacheDir,
  assertOfficialZipUrl,
  pdfCacheKey,
  displayPdfFilename,
  getSigningSecret,
  signPdfPath,
  verifySignedPdf,
  getCachedPdfInfo,
};
