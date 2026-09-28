const {
  parseMeetings,
  parseAgenda,
  officialUrl,
} = require("../../utils/threeGppCatalog");

test.each([
  ["CT4", "TSGCT4_125_Prague"],
  ["CT6", "CT6-98e"],
])("supports %s official folder prefix", (group, folder) => {
  const items = parseMeetings(
    `<a href="${folder}/">meeting</a>`,
    "https://www.3gpp.org/ftp/test/",
    group
  );
  expect(items).toHaveLength(1);
  expect(items[0].id).toBe(folder);
});

test("meeting year comes from folder name, never modified timestamp", () => {
  const base = "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/";
  const items = parseMeetings(
    '<a href="TSGS2_176_Prague_2026-08/">meeting</a><a href="TSGS2_175/">2026-01-01</a><a href="https://evil.test/TSGS2_177/">bad</a>',
    base,
    "SA2"
  );
  expect(items.map((i) => [i.number, i.year])).toEqual([
    [175, null],
    [176, 2026],
  ]);
});

test("source URLs reject offsite, credentials and traversal", () => {
  for (const url of [
    "https://evil.test/ftp/",
    "http://www.3gpp.org/ftp/",
    "https://u:p@www.3gpp.org/ftp/",
    "https://www.3gpp.org/ftp/../secret",
  ])
    expect(() => officialUrl(url)).toThrow();
});

test("plain agenda numbers do not become KI definitions", () => {
  const items = parseAgenda(
    "<table><tr><td>20.6.4</td><td>User Plane Architecture</td></tr></table>",
    "https://www.3gpp.org/ftp/agenda.htm"
  );
  expect(items.length).toBeGreaterThan(0);
  expect(items.some((i) => /^KI#4/.test(i.label))).toBe(false);
});
