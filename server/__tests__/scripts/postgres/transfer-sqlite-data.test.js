const {
  normalizeValue,
  parseArgs,
  quoteIdentifier,
} = require("../../../scripts/postgres/transfer-sqlite-data");

describe("SQLite to PostgreSQL transfer helpers", () => {
  test("requires an explicit execute flag before writing", () => {
    expect(parseArgs([])).toEqual({ execute: false });
    expect(parseArgs(["--execute"])).toEqual({ execute: true });
  });

  test("quotes database identifiers", () => {
    expect(quoteIdentifier('table"name')).toBe('"table""name"');
  });

  test("converts SQLite booleans for PostgreSQL", () => {
    expect(normalizeValue(0, "boolean")).toBe(false);
    expect(normalizeValue(1, "boolean")).toBe(true);
    expect(normalizeValue("text", "text")).toBe("text");
    expect(normalizeValue(null, "boolean")).toBeNull();
  });

  test("converts SQLite epoch timestamps for PostgreSQL", () => {
    expect(
      normalizeValue(1_787_736_620_867, "timestamp without time zone")
    ).toEqual(new Date(1_787_736_620_867));
    expect(normalizeValue("1787736620", "timestamp with time zone")).toEqual(
      new Date(1_787_736_620_000)
    );
    expect(
      normalizeValue("2026-09-03T12:00:00.000Z", "timestamp without time zone")
    ).toBe("2026-09-03T12:00:00.000Z");
  });

  test("removes NUL bytes that PostgreSQL text columns reject", () => {
    const stats = { nulBytesRemoved: 0 };
    expect(normalizeValue("before\0after\0", "text", stats)).toBe(
      "beforeafter"
    );
    expect(stats.nulBytesRemoved).toBe(2);
  });
});
