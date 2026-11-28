const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { invalid, getConfig } = require("./configAndSigning.ts");
const { watchFileSize } = require("./remoteZip.ts");

const execFileAsync = promisify(execFile);

async function moveFileAtomic(source: string, target: string): Promise<void> {
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

async function convertWordToPdf(
  inputPath: string,
  outDir: string,
  profileDir: string,
  onProgress?: (progress: { stage: string; pdfBytes: number }) => void
): Promise<string> {
  const { convertTimeoutMs, sofficeBin } = getConfig();
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });
  const profileUri = `file://${profileDir.replace(/\\/g, "/")}`;
  const expectedPdf = path.join(
    outDir,
    `${path.basename(inputPath, path.extname(inputPath))}.pdf`
  );

  const stopWatch =
    typeof onProgress === "function"
      ? watchFileSize(expectedPdf, 500, (bytes: number) => {
          if (bytes > 0) onProgress({ stage: "writing_pdf", pdfBytes: bytes });
        })
      : null;

  let result: { stdout?: string; stderr?: string };
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
  } catch (err: unknown) {
    const e = err as {
      code?: string;
      killed?: boolean;
      signal?: string;
      stderr?: string;
      message?: string;
    };
    if (e && e.code === "ENOENT")
      throw invalid(
        "服务器未安装 LibreOffice，暂无法将 Word 转为 PDF，请先下载 3GPP 原包。",
        503
      );
    if (e && (e.killed || e.signal === "SIGKILL"))
      throw invalid(
        `Word 转 PDF 超过 ${Math.round(convertTimeoutMs / 1000)} 秒未完成，建议直接下载 3GPP 原包。`,
        504
      );
    const detail = String(e?.stderr || e?.message || "").trim();
    throw invalid(
      detail
        ? `Word 转 PDF 失败：${detail.slice(0, 160)}`
        : "Word 转 PDF 失败，请稍后重试或直接下载 3GPP 原包。",
      500
    );
  } finally {
    if (stopWatch) stopWatch();
  }

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

module.exports = {
  moveFileAtomic,
  convertWordToPdf,
};
