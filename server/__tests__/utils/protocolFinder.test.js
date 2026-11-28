jest.mock("node:child_process", () => ({ execFile: jest.fn() }));
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { resolveProtocol } = require("../../utils/protocolFinder");
const { resetJobsForTest } = require("../../utils/protocolFinderPdf");

let storage, previousStorage;

const ETSI_HTML =
  '<a href="/18.06.00_60/">18.06.00_60</a><br><a href="/17.01.00_60/">17.01.00_60</a>';

function http404Error(code = 404) {
  return Object.assign(new Error(`curl ${code}`), {
    code: 22,
    stderr: `The requested URL returned error: ${code}`,
  });
}

function makeArchiveHtml(specDir, files) {
  return `<table><tbody>${files
    .map(
      ({ name, date = "2026/10/29 14:16", size = "1024,0 KB" }) =>
        `<tr><td><input type="checkbox" value="${name}" /></td><td></td><td><a class="file" href="https://www.3gpp.org/ftp/Specs/archive/${specDir}/${name}">${name}</a></td><td>${date}</td><td>${size}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

beforeEach(async () => {
  previousStorage = process.env.STORAGE_DIR;
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "protocol-finder-test-"));
  process.env.STORAGE_DIR = storage;
  resetJobsForTest();
  execFile.mockReset();
  execFile.mockImplementation((command, args, options, callback) => {
    const url = args[args.length - 1] || "";
    if (url.includes("www.etsi.org")) {
      callback(null, { stdout: ETSI_HTML });
      return;
    }
    callback(http404Error(404));
  });
});

afterEach(async () => {
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorage;
  await fs.rm(storage, { recursive: true, force: true });
});

test("rejects URLs and invalid versions before any request", async () => {
  for (const q of [
    "https://example.com/",
    "../../etc/passwd",
    "38.413;echo test",
  ])
    await expect(resolveProtocol({ q })).rejects.toMatchObject({ status: 400 });
  await expect(
    resolveProtocol({ q: "38.413", v: "latest" })
  ).rejects.toMatchObject({ status: 400 });
  expect(execFile).not.toHaveBeenCalled();
});

test("maps archive version to official ETSI directory and respects proxy environment", async () => {
  const r = await resolveProtocol({ q: "38413-i60.zip" });
  expect(r).toMatchObject({
    type: "TS",
    id: "38.413",
    requested: "18.6.0",
    dir: "https://www.etsi.org/deliver/etsi_ts/138400_138499/138413/",
  });
  expect(r.index.entries.map((x) => x.version)).toEqual(["18.6.0", "17.1.0"]);
  expect(execFile.mock.calls[0][1]).not.toContain("--noproxy");
  const callsAfterFirst = execFile.mock.calls.length;
  await resolveProtocol({ q: "TS 38.413" });
  expect(execFile).toHaveBeenCalledTimes(callsAfterFirst);
});

test("handles multipart numbers and returns only a PDF inside official directory", async () => {
  const r = await resolveProtocol({ q: "38.523-3" });
  expect(r.dir).toContain("/13852303/");
  execFile.mockImplementation((command, args, options, callback) =>
    callback(null, {
      stdout:
        '<a href="/deliver/etsi_ts/138500_138599/13852303/18.06.00_60/ts_13852303v180600p.pdf">PDF</a>',
    })
  );
  const pdf = await resolveProtocol({ q: "38.523-3", v: "18.6.0" });
  expect(pdf.pdf).toBe(r.dir + "18.06.00_60/ts_13852303v180600p.pdf");
  expect(pdf.source).toBe("etsi");
});

test("failed refresh keeps saved directory and reports that it is cached", async () => {
  await resolveProtocol({ q: "38.413" });
  execFile.mockImplementation((command, args, options, callback) =>
    callback(new Error("offline"))
  );
  const r = await resolveProtocol({ q: "38.413", refresh: "1" });
  expect(r.warning).toContain("刷新失败");
  expect(r.index.entries).toHaveLength(2);
});

test("merges ETSI frozen versions with newer Rel-20 3GPP archive versions", async () => {
  execFile.mockImplementation((command, args, options, callback) => {
    const url = args[args.length - 1] || "";
    if (url.includes("www.etsi.org")) {
      callback(null, {
        stdout: '<a href="/19.09.00_60/">19.09.00_60</a><br>',
      });
      return;
    }
    if (url.includes("/archive/23_series/23.501/")) {
      callback(null, {
        stdout: makeArchiveHtml("23_series/23.501", [
          { name: "23501-j90.zip", date: "2026/09/15 10:00", size: "5200,5 KB" },
          { name: "23501-k30.zip", date: "2026/10/20 12:00", size: "5400,2 KB" },
        ]),
      });
      return;
    }
    callback(http404Error(404));
  });

  const r = await resolveProtocol({ q: "23.501" });
  expect(r.sources).toEqual({ etsi: true, threeGpp: true });
  expect(r.index.entries).toEqual([
    expect.objectContaining({
      version: "20.3.0",
      source: "3gpp",
      zipName: "23501-k30.zip",
    }),
    expect.objectContaining({
      version: "19.9.0",
      source: "etsi",
      zipName: "23501-j90.zip",
    }),
  ]);
});

test("resolves 3GPP-only Rel-20 draft TR 23.801-01 and lists split KI docx members via HTTP Range", async () => {
  const zip = new AdmZip();
  zip.addFile("23801-01-0a0_cover_s05.docx", Buffer.from("cover-docx-content"));
  zip.addFile("23801-01-0a0_s06_04.docx", Buffer.from("ki4-docx-content"));
  zip.addFile("23801-01-0a0_s06_04_rm.docx", Buffer.from("ki4-rm-content"));
  const zipBuf = zip.toBuffer();

  execFile.mockImplementation((command, args, options, callback) => {
    const url = args[args.length - 1] || "";
    if (url.includes("www.etsi.org")) {
      callback(http404Error(404));
      return;
    }
    if (url.endsWith("/archive/23_series/23.801-01/")) {
      callback(null, {
        stdout: makeArchiveHtml("23_series/23.801-01", [
          {
            name: "23801-01-0a0.zip",
            date: "2026/10/29 14:16",
            size: "70309,7 KB",
          },
        ]),
      });
      return;
    }
    if (url.endsWith("/23801-01-0a0.zip") && args.includes("-fsSIL")) {
      callback(null, {
        stdout: `HTTP/2 200\r\ncontent-length: ${zipBuf.length}\r\naccept-ranges: bytes\r\n\r\n`,
      });
      return;
    }
    if (url.endsWith("/23801-01-0a0.zip") && args.includes("-r")) {
      const range = args[args.indexOf("-r") + 1];
      const [start, end] = range.split("-").map(Number);
      callback(null, { stdout: zipBuf.subarray(start, end + 1) });
      return;
    }
    callback(http404Error(403));
  });

  const r = await resolveProtocol({ q: "23.801-01" });
  expect(r.type).toBe("TR");
  expect(r.id).toBe("23.801-01");
  expect(r.sources).toEqual({ etsi: false, threeGpp: true });
  expect(r.index.entries[0]).toMatchObject({
    version: "0.10.0",
    source: "3gpp",
    zipName: "23801-01-0a0.zip",
    zipSize: "68.7 MB",
  });

  const detail = await resolveProtocol({ q: "TR 23.801-01", v: "0.10.0" });
  expect(detail.source).toBe("3gpp");
  expect(detail.members.map((m) => m.name)).toEqual([
    "23801-01-0a0_cover_s05.docx",
    "23801-01-0a0_s06_04.docx",
    "23801-01-0a0_s06_04_rm.docx",
  ]);
  expect(detail.members[0].label).toContain("封面与第 1～5 章");
  expect(detail.members[1].label).toContain("KI#4");
  expect(detail.members[2].isRevisionMarked).toBe(true);
});

test("guides users to sub-specs when querying base spec 23801 or sub-only 32801", async () => {
  execFile.mockImplementation((command, args, options, callback) => {
    const url = args[args.length - 1] || "";
    if (url.includes("www.etsi.org")) {
      callback(http404Error(404));
      return;
    }
    if (url.endsWith("/archive/23_series/")) {
      callback(null, {
        stdout:
          '<a href="https://www.3gpp.org/ftp/Specs/archive/23_series/23.801">23.801</a>' +
          '<a href="https://www.3gpp.org/ftp/Specs/archive/23_series/23.801-01">23.801-01</a>' +
          '<a href="https://www.3gpp.org/ftp/Specs/archive/23_series/23.801-02">23.801-02</a>',
      });
      return;
    }
    if (url.endsWith("/archive/23_series/23.801/")) {
      callback(null, {
        stdout: makeArchiveHtml("23_series/23.801", [
          { name: "23801-100.zip", date: "2004/06/14 10:00", size: "520 KB" },
        ]),
      });
      return;
    }
    if (url.endsWith("/archive/32_series/")) {
      callback(null, {
        stdout:
          '<a href="https://www.3gpp.org/ftp/Specs/archive/32_series/32.801-01">32.801-01</a>' +
          '<a href="https://www.3gpp.org/ftp/Specs/archive/32_series/32.801-02">32.801-02</a>',
      });
      return;
    }
    callback(http404Error(404));
  });

  const r23801 = await resolveProtocol({ q: "23801" });
  expect(r23801.id).toBe("23.801");
  expect(r23801.subSpecs).toEqual([
    expect.objectContaining({
      id: "23.801-01",
      group: "SA2",
      title: "6G 系统架构",
      kiCount: 24,
    }),
    expect.objectContaining({
      id: "23.801-02",
      group: "SA6",
      title: "6G 应用使能",
    }),
  ]);

  const r32801 = await resolveProtocol({ q: "32801" });
  expect(r32801.index.entries).toEqual([]);
  expect(r32801.subSpecs.map((s) => s.id)).toEqual(["32.801-01", "32.801-02"]);
});
