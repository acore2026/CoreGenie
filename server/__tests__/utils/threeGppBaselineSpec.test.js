const AdmZip = require("adm-zip");
const {
  parseSpecInput,
  parseReleaseInput,
  listOfficialBaselineVersions,
  downloadOfficialBaselineDocx,
} = require("../../utils/threeGppBaselineSpec");

const SAMPLE_ARCHIVE_HTML = `
<html><body><table>
  <tr><td><a class="file" href="https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/29574-k00.zip">29574-k00.zip</a></td><td>2026/06/25 10:00</td><td>210 KB</td></tr>
  <tr><td><a class="file" href="https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/29574-k10.zip">29574-k10.zip</a></td><td>2026/09/25 10:00</td><td>225 KB</td></tr>
  <tr><td><a class="file" href="https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/29574-j50.zip">29574-j50.zip</a></td><td>2026/09/25 10:00</td><td>200 KB</td></tr>
  <tr><td><a class="file" href="https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/29574-i80.zip">29574-i80.zip</a></td><td>2026/03/25 10:00</td><td>190 KB</td></tr>
</table></body></html>
`;

function makeZipBuffer(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

describe("threeGppBaselineSpec", () => {
  test("parses valid spec and release inputs and rejects invalid values", () => {
    expect(parseSpecInput("TS 29.574")).toMatchObject({
      series: "29",
      item: "574",
      id: "29.574",
    });
    expect(parseReleaseInput("Rel-20")).toEqual({ major: 20, label: "Rel-20" });
    expect(parseReleaseInput("18")).toEqual({ major: 18, label: "Rel-18" });

    expect(() => parseSpecInput("../29.574")).toThrow();
    expect(() => parseSpecInput("https://evil.test")).toThrow();
    expect(() => parseReleaseInput("Rel-99")).toThrow();
  });

  test("lists release-specific versions sorted descending", async () => {
    const result = await listOfficialBaselineVersions("29.574", "Rel-20", {
      fetchDirectory: jest.fn().mockResolvedValue(SAMPLE_ARCHIVE_HTML),
    });
    expect(result.spec).toBe("29.574");
    expect(result.release).toBe("Rel-20");
    expect(result.versions.map((v) => v.version)).toEqual(["20.1.0", "20.0.0"]);
    expect(result.latest.zipName).toBe("29574-k10.zip");
  });

  test("downloads latest release zip and extracts main .docx ignoring temp files", async () => {
    const zipBuffer = makeZipBuffer({
      "~$29574-k10.docx": "temp",
      "29574-k10.docx": "PK-fake-docx-content",
      "readme.txt": "info",
    });
    const fetchZip = jest.fn().mockResolvedValue(zipBuffer);
    const result = await downloadOfficialBaselineDocx("29.574", "Rel-20", "", {
      fetchDirectory: jest.fn().mockResolvedValue(SAMPLE_ARCHIVE_HTML),
      fetchZip,
    });
    expect(fetchZip).toHaveBeenCalledWith(
      "https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/29574-k10.zip",
      undefined
    );
    expect(result.name).toBe("29574-k10.docx");
    expect(result.version).toBe("20.1.0");
    expect(Buffer.from(result.content, "base64").toString("utf8")).toBe(
      "PK-fake-docx-content"
    );
  });

  test("returns clear 422 error when archive zip only contains legacy .doc", async () => {
    const zipBuffer = makeZipBuffer({
      "29574-i80.doc": "legacy-doc",
    });
    await expect(
      downloadOfficialBaselineDocx("29.574", "Rel-18", "", {
        fetchDirectory: jest.fn().mockResolvedValue(SAMPLE_ARCHIVE_HTML),
        fetchZip: jest.fn().mockResolvedValue(zipBuffer),
      })
    ).rejects.toMatchObject({
      status: 422,
      publicMessage: expect.stringContaining(".doc"),
    });
  });

  test("returns 404 when requested release has no archive entry", async () => {
    await expect(
      downloadOfficialBaselineDocx("29.574", "Rel-17", "", {
        fetchDirectory: jest.fn().mockResolvedValue(SAMPLE_ARCHIVE_HTML),
        fetchZip: jest.fn(),
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});
