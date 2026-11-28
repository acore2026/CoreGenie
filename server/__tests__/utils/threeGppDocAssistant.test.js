const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const {
  classifyDocId,
  matchSpecFilename,
  extractConferenceNumber,
} = require("../../utils/threeGppClassifier");
const assistant = require("../../utils/threeGppDocAssistant");
const sources = require("../../utils/threeGppSources");

test.each([
  ["S22403692", "tdoc", "S2-2403692"],
  ["S2-2500105r02", "tdoc", "S2-2500105r02"],
  ["S3i240296", "tdoc", "S3i240296"],
  ["RP-243021", "tdoc", "RP-243021"],
  ["23.501", "spec", "23.501"],
  ["23501", "spec", "23.501"],
  ["TS38.413", "spec", "38.413"],
  ["23501040", "spec", "23.501", "18.4.0"],
  ["23.501i40", "spec", "23.501", "18.4.0"],
  ["23.700-25-i00", "spec", "23.700-25", "18.0.0"],
  ["38101-1", "spec", "38.101-1"],
  ["37.716-44-22-100", "spec", "37.716-44-22", "1.0.0"],
  ["RFC 2697", "rfc", "rfc2697"],
  ["draft-mp-agntcy-ads-00", "ietf-draft", "draft-mp-agntcy-ads-00"],
  ["SWS-2450010", "workshop", "SWS-2450010"],
])("%s routes to the expected document", (q, kind, normalizedId, version = undefined) => {
  const result = classifyDocId(q);
  expect(result).toMatchObject({ kind, normalizedId });
  if (version) expect(result.parsedSpec.requestedVersion).toBe(version);
});

test("matches the exact spec and extracts the meeting number from an LI directory", () => {
  expect(
    matchSpecFilename(
      ["235014-i50.zip", "23501-i10.zip", "23501-i40.zip"],
      classifyDocId("23501").parsedSpec
    )
  ).toBe("23501-i40.zip");
  expect(extractConferenceNumber("TSGS3_LI_100", "S3i")).toBe(100);
});

test("CR status and title come from the WG row, even in a nested table", () => {
  const cells = [
    "",
    "",
    "23.501",
    "5473",
    "1",
    "F",
    "18.6.0",
    "Rel-18",
    "Withdrawn data in subscription",
    '<img id="wgTdocDetailsImg" title="S2-2407853">',
    "agreed",
    "SA2#164",
    "Nokia",
    "",
    "approved",
  ];
  const row = cells.map((c) => "<td>" + c + "</td>").join("");
  const html =
    "<table><tr><td><table><tr>" +
    row +
    "</tr><tr>" +
    row.replace("agreed", "withdrawn") +
    "</tr></table></td></tr></table>";
  expect(assistant.parseChangeRequestsHtml(html)).toEqual([
    expect.objectContaining({
      title: cells[8],
      tdoc: "S2-2407853",
      withdrawn: false,
      meeting: "SA2#164",
    }),
    expect.objectContaining({ withdrawn: true }),
  ]);
});

describe("mounted mirror", () => {
  let root, previous;
  const rel = "tsg_sa/WG2_Arch/TSGS2_164_Maastricht";
  const document = "S2-2407853";
  beforeEach(async () => {
    previous = process.env.THREE_GPP_LOCAL_MIRROR_DIR;
    root = await fs.mkdtemp(path.join(os.tmpdir(), "tdoc-mirror-"));
    process.env.THREE_GPP_LOCAL_MIRROR_DIR = root;
    await fs.mkdir(path.join(root, rel, "Docs"), { recursive: true });
    const zip = new AdmZip();
    zip.addFile("draft.rtf", Buffer.from("{\\rtf1 Fixture}"));
    zip.addFile("slides.pdf", Buffer.from("%PDF-1.4"));
    await fs.writeFile(
      path.join(root, rel, "Docs", document + ".zip"),
      zip.toBuffer()
    );
    await fs.writeFile(path.join(root, rel, "TdocsByAgenda.htm"), "agenda");
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.THREE_GPP_LOCAL_MIRROR_DIR;
    else process.env.THREE_GPP_LOCAL_MIRROR_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  test("lookup, extract, agenda and batch read from the same meeting and source", async () => {
    const onProgress = jest.fn();
    const r = await assistant.lookupDocument({
      q: document,
      hint: "164",
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ total: 1 })
    );
    expect(r).toMatchObject({ sourceId: "local-mirror", meetingNumber: 164 });
    expect(r.members.map((x) => x.name)).toEqual(["draft.rtf", "slides.pdf"]);
    const pdf = await assistant.extractDocMember({
      zipUrl: r.zipUrl,
      member: "slides.pdf",
    });
    expect(pdf.buffer.toString()).toBe("%PDF-1.4");
    const meeting = await assistant.resolveAgendaAndNotes({
      group: "SA2",
      meeting: "164",
    });
    expect(meeting.agenda).toHaveLength(1);
    const batch = await assistant.listBatchItems({
      mode: "url",
      url: sources.PUBLIC_FTP_BASE + rel + "/Docs/",
    });
    expect(batch.files[0].name).toBe(document + ".zip");
    const buffer = await assistant.buildBatchArchive({
      items: [{ url: batch.files[0].url }, { url: "bad-url" }],
    });
    expect(buffer).toMatchObject({ succeeded: 1, failed: 1 });
    expect(
      new AdmZip(buffer.buffer).getEntry(document + ".zip").getData()
    ).toEqual(
      await fs.readFile(path.join(root, rel, "Docs", document + ".zip"))
    );
  });
  test("cancelled lookup stops before probing a source", async () => {
    await expect(
      assistant.lookupDocument({ q: document, signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

test("Excel import preserves revisions and removes duplicate IDs", async () => {
  const book = new ExcelJS.Workbook();
  book
    .addWorksheet("TDocs")
    .addRows([["S22403692"], ["S2-2403692", "S2-2500105r02"]]);
  expect(
    (await assistant.parseBatchExcelBuffer(await book.xlsx.writeBuffer())).tdocs
  ).toEqual(["S2-2403692", "S2-2500105r02"]);
});
