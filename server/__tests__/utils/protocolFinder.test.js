jest.mock("node:child_process", () => ({ execFile: jest.fn() }));
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { resolveProtocol } = require("../../utils/protocolFinder");
let storage, previous;
beforeEach(async () => {
  previous = process.env.STORAGE_DIR;
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "protocol-finder-test-"));
  process.env.STORAGE_DIR = storage;
  execFile.mockReset();
  execFile.mockImplementation((command, args, options, callback) => {
    callback(null, {
      stdout:
        '<a href="/18.06.00_60/">18.06.00_60</a><br><a href="/17.01.00_60/">17.01.00_60</a>',
    });
  });
});
afterEach(async () => {
  if (previous === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previous;
  await fs.rm(storage, { recursive: true });
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
  await resolveProtocol({ q: "TS 38.413" });
  expect(execFile).toHaveBeenCalledTimes(1);
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
