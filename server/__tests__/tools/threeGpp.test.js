/* eslint-env jest, node */
const AdmZip = require("adm-zip");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  DIRECTORY_BY_GROUP,
  downloadOfficialTdoc,
  latestMeeting,
  meetingFolders,
  meetingFoldersForYear,
  officialPdfLinks,
  parseTdoc,
  resolveMeeting,
} = require("../../tools/threeGpp");

describe("3GPP meeting resolver", () => {
  const temporaryRoots = [];

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("uses canonical working-group directories", () => {
    expect(DIRECTORY_BY_GROUP).toMatchObject({
      SA1: "tsg_sa/WG1_Serv",
      SA2: "tsg_sa/WG2_Arch",
      SA3: "tsg_sa/WG3_Security",
      SA5: "tsg_sa/WG5_OAM",
      CT1: "tsg_ct/WG1_NAS",
      CT4: "tsg_ct/WG4_PROCO",
    });
  });

  it("extracts the numbered meeting folders without adjacent meetings", () => {
    const html = `
      <a href="TSGS2_174_Athens_2026-02/">174</a>
      <a href="TSGS2_175_Dalian_2026-05/">175</a>
      <a href="TSGS2_175-AH-e_Electronic_2026-06/">175 AH</a>
      <a href="TSGS2_176_Gothenburg_2026-08/">176</a>`;

    expect(meetingFolders(html, "SA2", 175)).toEqual([
      "TSGS2_175_Dalian_2026-05",
      "TSGS2_175-AH-e_Electronic_2026-06",
    ]);
  });

  it("derives the working group and year from one TDoc number", () => {
    expect(parseTdoc("s2-2606085")).toEqual({
      tdoc: "S2-2606085",
      group: "SA2",
      year: 2026,
    });
    expect(parseTdoc("C4-261072")).toEqual({
      tdoc: "C4-261072",
      group: "CT4",
      year: 2026,
    });
    expect(parseTdoc("R2-260001")).toBeNull();
  });

  it("sorts official meeting folders for the TDoc year from newest to oldest", () => {
    const html = `
      <a href="TSGS2_175-AH-e_Electronic_2026-06/">175 AH</a>
      <a href="TSGS2_176_Prague_2026-08/">176</a>
      <a href="TSGS2_174_Athens_2025-12/">174</a>`;

    expect(meetingFoldersForYear(html, "SA2", 2026)).toEqual([
      "TSGS2_176_Prague_2026-08",
      "TSGS2_175-AH-e_Electronic_2026-06",
    ]);
  });

  it("selects the latest regular meeting no later than the current month", () => {
    const html = `
      <a href="TSGS2_176_Prague_2026-08/">176</a>
      <a href="TSGS2_177-AH-e_Online_2026-09/">177 AH</a>
      <a href="TSGS2_177_Berlin_2026-10/">177</a>
      <a href="TSGS2_175_Dalian_2026-05/">175</a>`;

    expect(
      latestMeeting(html, "SA2", new Date("2026-09-01T00:00:00Z"))
    ).toEqual({
      folder: "TSGS2_176_Prague_2026-08",
      meetingNumber: 176,
    });
  });

  it("downloads the exact official ZIP with a browser user agent and extracts its DOCX", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "threegpp-tool-test-")
    );
    temporaryRoots.push(root);
    const archive = new AdmZip();
    archive.addFile("S2-2606085.docx", Buffer.from("test-docx"));
    const archiveBuffer = archive.toBuffer();
    const listing = `
      <a href="TSGS2_176_Prague_2026-08/">176</a>
      <a href="TSGS2_175-AH-e_Electronic_2026-06/">175 AH</a>`;
    const response = ({ status = 200, body = Buffer.alloc(0), text = "" }) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-length": String(body.length) }),
      text: jest.fn().mockResolvedValue(text),
      arrayBuffer: jest.fn().mockResolvedValue(body),
    });
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(response({ text: listing }))
      .mockResolvedValueOnce(response({ status: 404 }))
      .mockResolvedValueOnce(response({ body: archiveBuffer }));
    const manager = {
      validatePath: jest.fn(async (relative) => path.join(root, relative)),
    };

    const result = await downloadOfficialTdoc(
      parseTdoc("S2-2606085"),
      { signal: new AbortController().signal },
      manager
    );

    expect(result).toMatchObject({
      ok: true,
      folder: "TSGS2_175-AH-e_Electronic_2026-06",
      docxRelative:
        "3gpp-review/TSGS2_175-AH-e_Electronic_2026-06/docs/S2-2606085.docx",
      cached: false,
    });
    expect(
      await fs.readFile(path.join(root, result.docxRelative), "utf8")
    ).toBe("test-docx");
    for (const [, options] of fetchMock.mock.calls)
      expect(options.headers["User-Agent"]).toMatch(/^Mozilla\/5\.0/);
  });

  it("fetches only the canonical parent and returns official candidate URLs", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: jest
        .fn()
        .mockResolvedValue('<a href="TSGS2_175_Dalian_2026-05/">SA2#175</a>'),
    });

    const result = await resolveMeeting.execute(
      { group: "SA2", meeting_number: 175 },
      { signal: new AbortController().signal }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/",
      expect.any(Object)
    );
    expect(result.candidates).toEqual([
      {
        folder: "TSGS2_175_Dalian_2026-05",
        url: "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/TSGS2_175_Dalian_2026-05/",
      },
    ]);
    expect(result.relatedCandidates).toEqual([]);
    expect(result.officialDetails).toBeNull();
  });

  it("resolves the latest regular meeting directly from the official listing", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(`
        <a href="TSGS2_175_Dalian_2026-05/">175</a>
        <a href="TSGS2_176_Prague_2026-08/">176</a>`),
    });

    const result = await resolveMeeting.execute(
      { group: "SA2", latest: true, include_invitation: false },
      { signal: new AbortController().signal }
    );

    expect(result).toMatchObject({
      group: "SA2",
      meetingNumber: 176,
      latest: true,
      candidates: [{ folder: "TSGS2_176_Prague_2026-08" }],
    });
  });

  it("accepts only same-origin PDF links under the official invitation path", () => {
    const base =
      "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/TSGS2_175_Dalian_2026-05/Invitation/";
    const html = `
      <a href="Invitation%20SA2%23175.pdf">official</a>
      <a href="https://example.com/untrusted.pdf">external</a>
      <a href="../Report/report.pdf">outside</a>`;

    expect(officialPdfLinks(html, base)).toEqual([
      `${base}Invitation%20SA2%23175.pdf`,
    ]);
  });
});
