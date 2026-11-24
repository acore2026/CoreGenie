jest.mock("../../utils/threeGppCatalog", () => ({
  meetings: jest.fn(),
  readOfficial: jest.fn(),
  readOfficialBuffer: jest.fn(),
  links: jest.fn(),
}));
const catalog = require("../../utils/threeGppCatalog");
const { downloadMeetingList } = require("../../utils/threeGppMeetingList");
const root = "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/SA2_176/";
const list = `${root}Docs/TDoc_List_Meeting_SA2%23176.xlsx`;
beforeEach(() => {
  jest.resetAllMocks();
  catalog.meetings.mockResolvedValue({
    meetings: [{ id: "SA2_176", number: 176, suffix: "", source: root }],
  });
  catalog.readOfficial.mockResolvedValue("html");
  catalog.links
    .mockReturnValueOnce([{ name: "Docs", url: `${root}Docs/` }])
    .mockReturnValueOnce([
      { name: "TDoc_List_Meeting_SA2#176.xlsx", url: list },
    ]);
  catalog.readOfficialBuffer.mockResolvedValue(Buffer.from("xlsx"));
});
test("downloads the exact official list with provenance", async () => {
  const signal = new AbortController().signal;
  const result = await downloadMeetingList("SA2", "SA2_176", signal);
  expect(result).toEqual({
    name: "TDoc_List_Meeting_SA2#176.xlsx",
    source: list,
    fetchedAt: expect.any(String),
    content: Buffer.from("xlsx").toString("base64"),
  });
  expect(catalog.readOfficialBuffer).toHaveBeenCalledWith(list, 0, signal);
});
test("does not resolve client URLs or unknown meetings", async () => {
  await expect(
    downloadMeetingList("SA2", "https://evil.test/")
  ).rejects.toThrow("meeting_not_found");
  expect(catalog.readOfficial).not.toHaveBeenCalled();
});
test("does not substitute a different meeting list", async () => {
  catalog.links
    .mockReset()
    .mockReturnValueOnce([{ name: "Docs", url: `${root}Docs/` }])
    .mockReturnValueOnce([
      { name: "TDoc_List_Meeting_SA2#175.xlsx", url: list },
    ]);
  await expect(downloadMeetingList("SA2", "SA2_176")).rejects.toThrow(
    "list_not_found"
  );
  expect(catalog.readOfficialBuffer).not.toHaveBeenCalled();
});
test("rejects ambiguous list links", async () => {
  catalog.links
    .mockReset()
    .mockReturnValueOnce([{ name: "Docs", url: `${root}Docs/` }])
    .mockReturnValueOnce(
      Array(2).fill({ name: "TDoc_List_Meeting_SA2#176.xlsx", url: list })
    );
  await expect(downloadMeetingList("SA2", "SA2_176")).rejects.toThrow(
    "list_not_found"
  );
});
test("propagates network errors", async () => {
  catalog.readOfficialBuffer.mockRejectedValue(new Error("timeout"));
  await expect(downloadMeetingList("SA2", "SA2_176")).rejects.toThrow(
    "timeout"
  );
});
