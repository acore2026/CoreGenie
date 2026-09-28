jest.mock("../../utils/globalReferenceCatalog", () => ({
  createCatalog: jest.fn(),
}));
const { createCatalog } = require("../../utils/globalReferenceCatalog");
const { readCatalog } = require("../../tools/referenceCatalog");

test("shared reference tool is read-only and paginates without workspace scope", async () => {
  const read = jest.fn(async () => ({
    revision: "v1",
    meetings: [{ id: "a" }, { id: "b" }],
    pending: false,
  }));
  createCatalog.mockReturnValue({ read });
  expect(readCatalog.action).toBe(false);
  const data = await readCatalog.execute(
    { group: "SA2", offset: 0, limit: 1 },
    {}
  );
  expect(read).toHaveBeenCalledWith("SA2", undefined);
  expect(data).toMatchObject({
    meetings: [{ id: "a" }],
    total: 2,
    nextOffset: 1,
    revision: "v1",
  });
});

test("tool schema rejects arbitrary URLs and invalid page sizes", () => {
  expect(
    readCatalog.schema.safeParse({
      group: "SA2",
      meeting: "https://example.com",
    }).success
  ).toBe(false);
  expect(
    readCatalog.schema.safeParse({ group: "SA2", limit: 1000 }).success
  ).toBe(false);
});
