const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  TEMP_PREFIX,
  STALE_TEMP_MS,
  JOB_RETENTION_MS,
  PRUNE_INTERVAL_MS,
  invalid,
  getConfig,
  pdfCacheDir,
  assertOfficialZipUrl,
  pdfCacheKey,
  displayPdfFilename,
  getCachedPdfInfo,
} = require("./configAndSigning.ts");
const {
  extractRemoteZipEntry,
  downloadDirectWordFile,
} = require("./remoteZip.ts");
const { assertAllowedThreeGppUrl } = require("../threeGppSources");
const { moveFileAtomic, convertWordToPdf } = require("./converter.ts");

type ZipEntryInfo = import("./remoteZip.ts").ZipEntryInfo;

interface JobProgress {
  stage: string;
  stageStartedAt: number;
  timeoutMs: number;
  wordBytes: number;
  downloadedBytes: number;
  downloadTotalBytes: number;
  pdfBytes: number;
}

interface ConversionJob {
  status: "queued" | "downloading" | "converting" | "ready" | "failed";
  hash: string;
  filename: string;
  error: string | null;
  size: number;
  startedAt: number;
  updatedAt: number;
  progress: JobProgress;
}

interface QueueTask {
  hash: string;
  filename: string;
  zipUrl: string | null;
  directUrl?: string | null;
  allowAnyFtp?: boolean;
  entry: ZipEntryInfo;
}

const jobs = new Map<string, ConversionJob>();
const queue: QueueTask[] = [];
let activeCount = 0;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
let maintenanceStarted = false;

async function cleanupStaleTempDirs(now = Date.now()): Promise<number> {
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

async function prunePdfCache(now = Date.now()): Promise<{
  expiredRemoved: number;
  lruRemoved: number;
  remainingBytes: number;
}> {
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
  const kept: Array<{ full: string; size: number; mtimeMs: number }> = [];

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

function startCacheMaintenance(): void {
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

function pruneOldJobRecords(now = Date.now()): void {
  for (const [key, job] of jobs.entries()) {
    if (
      (job.status === "ready" || job.status === "failed") &&
      now - job.updatedAt > JOB_RETENTION_MS
    ) {
      jobs.delete(key);
    }
  }
}

function pumpQueue(): void {
  const { maxConcurrency } = getConfig();
  while (activeCount < maxConcurrency && queue.length > 0) {
    const task = queue.shift();
    if (!task) break;
    activeCount++;
    runJob(task).finally(() => {
      activeCount--;
      pumpQueue();
    });
  }
}

function buildProgressSnapshot(job: ConversionJob, now = Date.now()) {
  if (!job?.progress) return undefined;
  const p = job.progress;
  const queueIndex =
    job.status === "queued"
      ? queue.findIndex((item) => item.hash === job.hash)
      : -1;
  return {
    stage: p.stage,
    queuePosition: queueIndex >= 0 ? queueIndex + 1 : 0,
    elapsedMs: Math.max(0, now - job.startedAt),
    stageElapsedMs: Math.max(0, now - (p.stageStartedAt || job.startedAt)),
    timeoutMs: p.timeoutMs,
    wordBytes: p.wordBytes,
    downloadedBytes: p.downloadedBytes || 0,
    downloadTotalBytes: p.downloadTotalBytes || 0,
    pdfBytes: p.pdfBytes || 0,
  };
}

async function runJob({
  hash,
  zipUrl,
  directUrl = null,
  allowAnyFtp = false,
  entry,
}: QueueTask): Promise<void> {
  const job = jobs.get(hash);
  if (!job) return;
  let tmpDir: string | null = null;
  try {
    const dlStart = Date.now();
    job.status = "downloading";
    job.updatedAt = dlStart;
    job.progress.stage = "downloading";
    job.progress.stageStartedAt = dlStart;
    job.progress.downloadedBytes = 0;
    job.progress.downloadTotalBytes =
      entry.compressedSize || entry.uncompressedSize || 0;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    const ext = path.posix.extname(entry.name).toLowerCase() || ".docx";
    const inputPath = path.join(tmpDir, `source${ext}`);
    if (directUrl) {
      const size = await downloadDirectWordFile(directUrl, inputPath);
      job.progress.downloadedBytes = size;
      job.progress.downloadTotalBytes = size;
      job.updatedAt = Date.now();
    } else if (zipUrl) {
      await extractRemoteZipEntry(
        zipUrl,
        entry,
        inputPath,
        tmpDir,
        (dl: { downloadedBytes: number; downloadTotalBytes: number }) => {
          job.progress.downloadedBytes = dl.downloadedBytes;
          job.progress.downloadTotalBytes = dl.downloadTotalBytes;
          job.updatedAt = Date.now();
        },
        { allowAnyFtp }
      );
    }

    const convStart = Date.now();
    job.status = "converting";
    job.updatedAt = convStart;
    job.progress.stage = "converting";
    job.progress.stageStartedAt = convStart;
    job.progress.pdfBytes = 0;

    const outDir = path.join(tmpDir, "out");
    const profileDir = path.join(tmpDir, "profile");
    const generatedPdf = await convertWordToPdf(
      inputPath,
      outDir,
      profileDir,
      (conv: { stage?: string; pdfBytes?: number }) => {
        if (conv.stage && job.progress.stage !== conv.stage) {
          job.progress.stage = conv.stage;
          job.progress.stageStartedAt = Date.now();
        }
        if (typeof conv.pdfBytes === "number") {
          job.progress.pdfBytes = conv.pdfBytes;
        }
        job.updatedAt = Date.now();
      }
    );

    job.progress.stage = "finalizing";
    job.progress.stageStartedAt = Date.now();
    const targetPath = path.join(pdfCacheDir(), `${hash}.pdf`);
    await moveFileAtomic(generatedPdf, targetPath);
    const stat = await fs.stat(targetPath);

    job.status = "ready";
    job.size = stat.size;
    job.error = null;
    job.updatedAt = Date.now();

    prunePdfCache().catch(() => {});
  } catch (err: unknown) {
    const e = err as {
      code?: unknown;
      publicMessage?: string;
      message?: string;
    };
    console.warn("[protocol-finder] convert failed:", {
      hash,
      member: entry?.name,
      code: e?.code,
      message: e?.publicMessage || e?.message,
    });
    job.status = "failed";
    job.error =
      e?.publicMessage ||
      "文档下载或转换失败，请稍后重试或直接下载 3GPP 原包。";
    job.updatedAt = Date.now();
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function getJobView(hash: string, filename: string) {
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
    progress: buildProgressSnapshot(job),
    cached: false,
  };
}

async function startConversion({
  archiveId,
  zipName,
  zipUrl,
  entry,
  allowAnyFtp = false,
  directUrl = null,
}: {
  archiveId: string;
  zipName: string;
  zipUrl?: string;
  entry: ZipEntryInfo;
  allowAnyFtp?: boolean;
  directUrl?: string | null;
}) {
  pruneOldJobRecords();
  const safeUrl =
    directUrl || allowAnyFtp
      ? assertAllowedThreeGppUrl(directUrl || zipUrl || "").url
      : assertOfficialZipUrl(zipUrl || "");
  const { wordMaxBytes, convertTimeoutMs } = getConfig();
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
      progress: buildProgressSnapshot(existing),
      cached: false,
    };
  }

  const startedAt = Date.now();
  const job: ConversionJob = {
    status: "queued",
    hash,
    filename,
    error: null,
    size: 0,
    startedAt,
    updatedAt: startedAt,
    progress: {
      stage: "queued",
      stageStartedAt: startedAt,
      timeoutMs: convertTimeoutMs,
      wordBytes: entry.uncompressedSize || 0,
      downloadedBytes: 0,
      downloadTotalBytes: entry.compressedSize || entry.uncompressedSize || 0,
      pdfBytes: 0,
    },
  };
  jobs.set(hash, job);
  queue.push({
    hash,
    filename,
    zipUrl: directUrl ? null : safeUrl,
    directUrl: directUrl ? safeUrl : null,
    allowAnyFtp,
    entry,
  });
  pumpQueue();

  return {
    status: job.status,
    hash,
    filename,
    progress: buildProgressSnapshot(job),
    cached: false,
  };
}

function resetJobsForTest(): void {
  jobs.clear();
  queue.length = 0;
  activeCount = 0;
}

module.exports = {
  cleanupStaleTempDirs,
  prunePdfCache,
  startCacheMaintenance,
  startConversion,
  getJobView,
  resetJobsForTest,
};
