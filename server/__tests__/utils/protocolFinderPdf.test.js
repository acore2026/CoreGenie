jest.mock("node:child_process", () => ({ execFile: jest.fn() }));
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const pdfTools = require("../../utils/protocolFinderPdf");

let storage;
let prevEnv;

beforeEach(async () => {
  prevEnv = {
    STORAGE_DIR: process.env.STORAGE_DIR,
    JWT_SECRET: process.env.JWT_SECRET,
    PROTOCOL_FINDER_PDF_TTL_DAYS: process.env.PROTOCOL_FINDER_PDF_TTL_DAYS,
    PROTOCOL_FINDER_PDF_MAX_MB: process.env.PROTOCOL_FINDER_PDF_MAX_MB,
    PROTOCOL_FINDER_WORD_MAX_MB: process.env.PROTOCOL_FINDER_WORD_MAX_MB,
  };
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "protocol-pdf-test-"));
  process.env.STORAGE_DIR = storage;
  process.env.JWT_SECRET = "test-secret-for-protocol-finder";
  delete process.env.PROTOCOL_FINDER_PDF_TTL_DAYS;
  delete process.env.PROTOCOL_FINDER_PDF_MAX_MB;
  delete process.env.PROTOCOL_FINDER_WORD_MAX_MB;
  pdfTools.resetJobsForTest();
  execFile.mockReset();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(storage, { recursive: true, force: true });
});

test("only permits official 3GPP Specs archive URLs", () => {
  expect(() =>
    pdfTools.assertOfficialZipUrl(
      "https://www.3gpp.org/ftp/Specs/archive/23_series/23.801-01/23801-01-0a0.zip"
    )
  ).not.toThrow();
  for (const bad of [
    "https://evil.example/23801-01-0a0.zip",
    "http://www.3gpp.org/ftp/Specs/archive/23_series/23.801-01/23801-01-0a0.zip",
    "https://www.3gpp.org/ftp/tsg_sa/other.zip",
    "file:///etc/passwd",
  ]) {
    expect(() => pdfTools.assertOfficialZipUrl(bad)).toThrow();
  }
});

test("signs and verifies short-lived PDF preview URLs and rejects expired or tampered tokens", async () => {
  const hash = pdfTools.pdfCacheKey(
    "23.801-01",
    "23801-01-0a0.zip",
    "23801-01-0a0_s06_02.docx"
  );
  const filename = pdfTools.displayPdfFilename("23801-01-0a0_s06_02.docx");
  expect(filename).toBe("23801-01-0a0_s06_02.pdf");

  const dir = pdfTools.pdfCacheDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${hash}.pdf`);
  await fs.writeFile(filePath, Buffer.from("%PDF-1.7\nhello"));

  const now = 1_700_000_000_000;
  const signed = await pdfTools.signPdfPath({ hash, filename, now });
  const url = new URL("http://localhost" + signed);
  const params = {
    hash,
    name: url.searchParams.get("name"),
    exp: url.searchParams.get("exp"),
    sig: url.searchParams.get("sig"),
  };

  const verified = await pdfTools.verifySignedPdf({
    ...params,
    now: now + 60_000,
  });
  expect(verified.filePath).toBe(filePath);
  expect(verified.filename).toBe(filename);

  // Tampered signature rejected
  await expect(
    pdfTools.verifySignedPdf({
      ...params,
      sig: params.sig.slice(0, -2) + "AA",
      now: now + 60_000,
    })
  ).rejects.toMatchObject({ status: 403 });

  // Expired URL rejected (after 30 minutes)
  await expect(
    pdfTools.verifySignedPdf({
      ...params,
      now: now + 1801_000,
    })
  ).rejects.toMatchObject({ status: 403 });
});

test("prunes expired PDFs by TTL and enforces LRU max-bytes cap", async () => {
  process.env.PROTOCOL_FINDER_PDF_TTL_DAYS = "14";
  // 100 KB cap (in MB)
  process.env.PROTOCOL_FINDER_PDF_MAX_MB = String(100 / 1024);

  const dir = pdfTools.pdfCacheDir();
  await fs.mkdir(dir, { recursive: true });

  const now = 1_750_000_000_000;
  const expiredFile = path.join(dir, `${"a".repeat(64)}.pdf`);
  const oldFile = path.join(dir, `${"b".repeat(64)}.pdf`);
  const midFile = path.join(dir, `${"c".repeat(64)}.pdf`);
  const freshFile = path.join(dir, `${"d".repeat(64)}.pdf`);

  await fs.writeFile(expiredFile, Buffer.alloc(10 * 1024, 1));
  await fs.writeFile(oldFile, Buffer.alloc(45 * 1024, 2));
  await fs.writeFile(midFile, Buffer.alloc(45 * 1024, 3));
  await fs.writeFile(freshFile, Buffer.alloc(45 * 1024, 4));

  const setAge = async (file, msAgo) => {
    const t = new Date(now - msAgo);
    await fs.utimes(file, t, t);
  };
  await setAge(expiredFile, 15 * 24 * 60 * 60 * 1000);
  await setAge(oldFile, 5 * 24 * 60 * 60 * 1000);
  await setAge(midFile, 2 * 24 * 60 * 60 * 1000);
  await setAge(freshFile, 1 * 60 * 60 * 1000);

  const summary = await pdfTools.prunePdfCache(now);
  expect(summary.expiredRemoved).toBe(1);
  // 135 KB remaining > 100 KB cap -> evict down to <= 80 KB (removes old + mid = 2 files, leaving 45 KB)
  expect(summary.lruRemoved).toBe(2);
  const files = await fs.readdir(dir);
  expect(files).toEqual([`${"d".repeat(64)}.pdf`]);
});

test("rejects Word documents exceeding the configured size limit", async () => {
  process.env.PROTOCOL_FINDER_WORD_MAX_MB = "1";
  await expect(
    pdfTools.startConversion({
      archiveId: "23.801-01",
      zipName: "23801-01-080.zip",
      zipUrl:
        "https://www.3gpp.org/ftp/Specs/archive/23_series/23.801-01/23801-01-080.zip",
      entry: {
        name: "23801-01-080_clean.docx",
        method: 8,
        compressedSize: 2 * 1024 * 1024,
        uncompressedSize: 2 * 1024 * 1024,
        localHeaderOffset: 0,
      },
    })
  ).rejects.toMatchObject({ status: 413 });
});

test("extracts a single docx via HTTP Range, converts via soffice, deduplicates jobs, and cleans up temp dir", async () => {
  const zip = new AdmZip();
  const docxBytes = Buffer.from("PK\x03\x04fake-docx-payload-12345");
  zip.addFile("23801-01-0a0_s06_02.docx", docxBytes);
  const zipBuf = zip.toBuffer();

  const seenTempDirs = [];
  execFile.mockImplementation((command, args, options, callback) => {
    if (command === "curl") {
      if (args.includes("-fsSIL")) {
        callback(null, {
          stdout: `HTTP/2 200\r\ncontent-length: ${zipBuf.length}\r\naccept-ranges: bytes\r\n\r\n`,
        });
        return;
      }
      if (args.includes("-r") && args.includes("-o")) {
        const range = args[args.indexOf("-r") + 1];
        const outFile = args[args.indexOf("-o") + 1];
        const [start, end] = range.split("-").map(Number);
        seenTempDirs.push(path.dirname(outFile));
        fs.writeFile(outFile, zipBuf.subarray(start, end + 1))
          .then(() => callback(null, { stdout: "" }))
          .catch((e) => callback(e));
        return;
      }
      if (args.includes("-r")) {
        const range = args[args.indexOf("-r") + 1];
        const [start, end] = range.split("-").map(Number);
        callback(null, { stdout: zipBuf.subarray(start, end + 1) });
        return;
      }
    }
    if (command === "soffice") {
      const outDir = args[args.indexOf("--outdir") + 1];
      const inputPath = args[args.length - 1];
      const pdfOut = path.join(
        outDir,
        `${path.basename(inputPath, path.extname(inputPath))}.pdf`
      );
      setTimeout(() => {
        fs.writeFile(pdfOut, Buffer.from("%PDF-1.7\nconverted"))
          .then(() => callback(null, { stdout: "", stderr: "" }))
          .catch((e) => callback(e));
      }, 25);
      return;
    }
    callback(new Error(`Unexpected execFile: ${command}`));
  });

  const zipUrl =
    "https://www.3gpp.org/ftp/Specs/archive/23_series/23.801-01/23801-01-0a0.zip";
  const inspected = await pdfTools.inspectRemoteZip(zipUrl);
  expect(inspected.entries).toHaveLength(1);
  const entry = inspected.entries[0];

  const [first, second] = await Promise.all([
    pdfTools.startConversion({
      archiveId: "23.801-01",
      zipName: "23801-01-0a0.zip",
      zipUrl,
      entry,
    }),
    pdfTools.startConversion({
      archiveId: "23.801-01",
      zipName: "23801-01-0a0.zip",
      zipUrl,
      entry,
    }),
  ]);
  expect(first.hash).toBe(second.hash);
  expect(first.progress).toMatchObject({
    wordBytes: docxBytes.length,
    timeoutMs: 300000,
  });

  // Wait for background job to finish
  let view;
  for (let i = 0; i < 40; i++) {
    view = await pdfTools.getJobView(first.hash, entry.name);
    if (view.status === "ready" || view.status === "failed") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(view.status).toBe("ready");
  expect(view.pdfPath).toContain(`/3gpp/protocol-finder/pdf/${first.hash}`);

  // Only one soffice invocation occurred despite two concurrent requests
  const sofficeCalls = execFile.mock.calls.filter((c) => c[0] === "soffice");
  expect(sofficeCalls).toHaveLength(1);

  // Intermediate Word temp directory was cleaned up immediately
  expect(seenTempDirs.length).toBeGreaterThan(0);
  await expect(fs.stat(seenTempDirs[0])).rejects.toThrow();
});
