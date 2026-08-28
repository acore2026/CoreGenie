/* eslint-env jest, node */
const {
  DIRECTORY_BY_GROUP,
  meetingFolders,
  officialPdfLinks,
  resolveMeeting,
} = require("../../tools/threeGpp");

describe("3GPP meeting resolver", () => {
  afterEach(() => jest.restoreAllMocks());

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

  it("fetches only the canonical parent and returns official candidate URLs", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: jest
        .fn()
        .mockResolvedValue(
          '<a href="TSGS2_175_Dalian_2026-05/">SA2#175</a>'
        ),
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
