const ExcelJS = require("exceljs");
const catalog = require("../../utils/threeGppCatalog");
const {
  meetingDocuments,
  parseTdocList,
} = require("../../utils/threeGppDocuments");
const { selectKiDocuments } = require("../../tools/threeGppSelection");

const meeting = {
  id: "TSGS2_177_Prague_2026-10",
  number: 177,
  suffix: "",
  source: "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/TSGS2_177_Prague_2026-10/",
};
const docsUrl = meeting.source + "Docs/";
const listUrl = docsUrl + "TDoc_List_Meeting_SA2%23177.xlsx";
const headers = [
  "TDoc",
  "Title",
  "Source",
  "Agenda item",
  "Agenda item description",
  "TDoc Status",
  "Spec",
  "Uploaded",
  "Is revision of",
  "Revised to",
  "Related WIs",
];
const row = (tdoc, status = "available", title = "[KI#2] SBA update") => [
  tdoc,
  title,
  "Huawei",
  "20.6.2",
  "SBA framework",
  status,
  "23.801-01",
  "2026-09-29",
  "S2-2600001",
  "",
  "FS_6G_ARC",
];
async function xlsx(rows = [row("S2-2610082")], columns = headers) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Notes").addRow(["Not the TDoc table"]);
  book.addWorksheet("TDocs").addRows([columns, ...rows]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
function directory(tdocs, listName = "TDoc_List_Meeting_SA2%23177.xlsx") {
  return `<html>${tdocs.map((id) => `<a href="${id}.zip">${id}.zip</a>`).join("")}<a href="${listName}">list</a></html>`;
}
beforeEach(() => {
  jest.spyOn(catalog, "agenda").mockResolvedValue({
    source: meeting.source + "TdocsByAgenda.htm",
    items: [{ value: "20.6.2", title: "SBA framework" }],
    documents: [],
    fetchedAt: "2026-09-30T08:00:00Z",
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  catalog.cache.clear();
});

test("finds new uploads in the matching TDoc table even when agenda is empty", async () => {
  const buffer = await xlsx([
    row("S2-2610082"),
    row("S2-2610083", "withdrawn"),
    row("S2-2610084", "reserved"),
  ]);
  jest.spyOn(global, "fetch").mockImplementation(async (url) => {
    url = String(url);
    if (url === meeting.source) return new Response('<a href="Docs/">Docs</a>');
    if (url === docsUrl)
      return new Response(
        directory(["s2-2610082", "S2-2610083", "S2-2610307"])
      );
    if (url === listUrl) return new Response(buffer);
    throw new Error(`Unexpected fetch ${url}`);
  });
  const result = await meetingDocuments("SA2", meeting);
  expect(result.selectionSource).toBe("official-tdoc-list");
  expect(result.source).toBe(listUrl);
  expect(result.documents[0]).toMatchObject({
    spec: "23.801-01",
    source: "Huawei",
    availability: "listed",
    isRevisionOf: "S2-2600001",
    downloadUrl: docsUrl + "s2-2610082.zip",
  });
  expect(result.documents[1].status).toBe("withdrawn");
  expect(result.documents[2].availability).toBe("reserved");
  expect(result.unindexedTdocs).toEqual(["S2-2610307"]);
  expect(result.warnings.join(" ")).toContain("1 份 ZIP");
  expect(selectKiDocuments(result, "KI2", "23.801-01").documents).toHaveLength(
    3
  );
  expect(catalog.agenda).not.toHaveBeenCalled();
});

test("refreshes the official table on every invocation", async () => {
  jest
    .spyOn(catalog, "readOfficial")
    .mockImplementation(async (url) =>
      url === meeting.source
        ? '<a href="Docs/">Docs</a>'
        : directory(["S2-2610082", "S2-2610083"])
    );
  jest
    .spyOn(catalog, "readOfficialBuffer")
    .mockResolvedValueOnce(await xlsx())
    .mockResolvedValueOnce(await xlsx([row("S2-2610082"), row("S2-2610083")]));
  expect((await meetingDocuments("SA2", meeting)).documents).toHaveLength(1);
  expect((await meetingDocuments("SA2", meeting)).documents).toHaveLength(2);
});

test("does not use a neighboring meeting's table or an offsite link", async () => {
  jest
    .spyOn(catalog, "readOfficial")
    .mockImplementation(async (url) =>
      url === meeting.source
        ? '<a href="Docs/">Docs</a>'
        : directory(["S2-2610082"], "TDoc_List_Meeting_SA2%23176.xlsx") +
          `<a href="https://evil.test/TDoc_List_Meeting_SA2%23177.xlsx">wrong</a>`
    );
  jest.spyOn(catalog, "readOfficialBuffer");
  const result = await meetingDocuments("SA2", meeting);
  expect(result.selectionSource).toBe("official-agenda-section");
  expect(result.warnings.join(" ")).toContain("范围尚未确认");
  expect(catalog.readOfficialBuffer).not.toHaveBeenCalled();
  expect(catalog.agenda).toHaveBeenCalledWith(
    "SA2",
    meeting.id,
    expect.objectContaining({ fresh: true, includeDocuments: true })
  );
});

test("retains agenda metadata and concrete errors when the TDoc table is corrupt", async () => {
  jest
    .spyOn(catalog, "readOfficial")
    .mockImplementation(async (url) =>
      url === meeting.source
        ? '<a href="Docs/">Docs</a>'
        : directory(["S2-2610082"])
    );
  jest
    .spyOn(catalog, "readOfficialBuffer")
    .mockResolvedValue(Buffer.from("not an xlsx"));
  catalog.agenda.mockResolvedValue({
    source: meeting.source + "TdocsByAgenda.htm",
    items: [],
    documents: [
      {
        document: "S2-2610082",
        agenda: "20.6.2",
        title: "23.801-01 KI#2",
        source: "Nokia",
        status: "revised",
      },
    ],
  });
  const result = await meetingDocuments("SA2", meeting);
  expect(result.documents[0]).toMatchObject({
    source: "Nokia",
    availability: "listed",
    status: "revised",
  });
  expect(result.sourceErrors[0]).toMatchObject({
    source: listUrl,
    error: expect.any(String),
  });
});

test("does not treat reserved as unavailable if its ZIP already exists", async () => {
  jest
    .spyOn(catalog, "readOfficial")
    .mockImplementation(async (url) =>
      url === meeting.source
        ? '<a href="Docs/">Docs</a>'
        : directory(["S2-2610082"])
    );
  jest
    .spyOn(catalog, "readOfficialBuffer")
    .mockResolvedValue(
      await xlsx([row("S2-2610082", "reserved"), row("S2-2610083")])
    );
  const result = await meetingDocuments("SA2", meeting);
  expect(result.documents.map((d) => d.availability)).toEqual([
    "listed",
    "missing",
  ]);
});

test("rejects malformed headers, foreign document groups and conflicting duplicates", async () => {
  await expect(
    parseTdocList(await xlsx([], ["TDoc", "Title"]), listUrl, "SA2")
  ).rejects.toThrow("缺少");
  await expect(
    parseTdocList(await xlsx([row("S3-2610082")]), listUrl, "SA2")
  ).rejects.toThrow("其他工作组");
  await expect(
    parseTdocList(
      await xlsx([row("S2-2610082"), row("S2-2610082", "withdrawn")]),
      listUrl,
      "SA2"
    )
  ).rejects.toThrow("冲突");
});

test("cancellation is not swallowed by fallback", async () => {
  const controller = new AbortController();
  jest.spyOn(catalog, "readOfficial").mockImplementation(async () => {
    controller.abort();
    throw new Error("cancelled");
  });
  await expect(
    meetingDocuments("SA2", meeting, { signal: controller.signal })
  ).rejects.toThrow();
  expect(catalog.agenda).not.toHaveBeenCalled();
});

test("retains both source errors when neither list nor agenda can be read", async () => {
  jest
    .spyOn(catalog, "readOfficial")
    .mockRejectedValue(new Error("Docs HTTP 503"));
  catalog.agenda.mockRejectedValue(new Error("agenda timeout"));
  const result = await meetingDocuments("SA2", meeting);
  expect(result.sourceErrors.map((item) => item.error)).toEqual([
    "Docs HTTP 503",
    "agenda timeout",
  ]);
  expect(result.documents).toEqual([]);
  expect(result.warnings.join(" ")).toContain("agenda timeout");
});

test("binary reads reject offsite redirects and oversized responses", async () => {
  jest.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.test/file.xlsx" },
    })
  );
  await expect(catalog.readOfficialBuffer(listUrl)).rejects.toThrow("只允许");
  fetch.mockResolvedValueOnce(
    new Response("too big", {
      headers: { "content-length": String(9 * 1024 * 1024) },
    })
  );
  await expect(catalog.readOfficialBuffer(listUrl)).rejects.toThrow("大小限制");
});
