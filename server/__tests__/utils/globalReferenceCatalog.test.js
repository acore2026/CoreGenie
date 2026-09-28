jest.mock("../../utils/prisma", () => ({}));
const {
  createCatalog,
  referenceKey,
} = require("../../utils/globalReferenceCatalog");

function fixture() {
  const rows = new Map();
  let time = new Date("2026-09-21T00:00:00Z");
  const matches = (r, w) =>
    (!w.key || r.key === w.key) &&
    (!w.leaseToken || r.leaseToken === w.leaseToken) &&
    (!w.nextRefreshAt || r.nextRefreshAt <= w.nextRefreshAt.lte) &&
    (!w.OR || !r.leaseUntil || r.leaseUntil < w.OR[1].leaseUntil.lt);
  const table = {
    upsert: jest.fn(async ({ where, create }) => {
      if (!rows.has(where.key))
        rows.set(where.key, { payload: null, lastSuccessAt: null, ...create });
      return { ...rows.get(where.key) };
    }),
    findUnique: jest.fn(async ({ where }) => rows.get(where.key) || null),
    findMany: jest.fn(async ({ where }) =>
      [...rows.values()].filter((r) => matches(r, where)).map((r) => ({ ...r }))
    ),
    updateMany: jest.fn(async ({ where, data }) => {
      let count = 0;
      for (const row of rows.values())
        if (matches(row, where)) {
          Object.assign(row, data);
          count++;
        }
      return { count };
    }),
  };
  const source = {
    GROUPS: ["SA2"],
    meetings: jest.fn(async () => ({
      group: "SA2",
      meetings: [
        {
          id: "TSGS2_176_2026-08",
          year: 2026,
          date: "2026-08",
          source: "https://www.3gpp.org/ftp/test/",
        },
      ],
    })),
    agenda: jest.fn(async () => ({
      items: [{ value: "1", label: "Test agenda" }],
    })),
  };
  const db = { global_reference_entries: table };
  return {
    rows,
    source,
    db,
    catalog: createCatalog(db, source, () => time),
    advance: (ms) => {
      time = new Date(+time + ms);
    },
  };
}

test("all readers share snapshots; reads enqueue without fetching online", async () => {
  const f = fixture();
  expect((await f.catalog.read("SA2")).pending).toBe(true);
  expect(f.source.meetings).not.toHaveBeenCalled();
  await f.catalog.sync();
  const first = await f.catalog.read("SA2");
  expect(first.pending).toBe(false);
  expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await createCatalog(f.db, f.source).read("SA2")).toMatchObject({
    revision: first.revision,
    meetings: first.meetings,
  });
  expect(f.source.meetings).toHaveBeenCalledTimes(1);
});

test("warm agendas run on next tick and receive persisted meeting metadata", async () => {
  const f = fixture();
  await f.catalog.sync();
  await f.catalog.sync();
  expect(f.source.agenda).toHaveBeenCalledWith("SA2", "TSGS2_176_2026-08", {
    meeting: expect.objectContaining({ year: 2026 }),
  });
  expect((await f.catalog.read("SA2", "TSGS2_176_2026-08")).items).toHaveLength(
    1
  );
});

test("failure preserves last successful snapshot and schedules retry", async () => {
  const f = fixture();
  await f.catalog.sync();
  const before = await f.catalog.read("SA2");
  f.advance(6 * 3600000);
  f.source.meetings.mockRejectedValue(new Error("network unavailable"));
  await f.catalog.sync();
  expect(await f.catalog.read("SA2")).toMatchObject({
    revision: before.revision,
    fetchedAt: before.fetchedAt,
    stale: true,
    pending: false,
  });
  expect(f.rows.get(referenceKey("SA2")).lastError).toBe("network unavailable");
});

test("leases prevent duplicate fetch and expired leases recover", async () => {
  const f = fixture();
  await f.catalog.read("SA2");
  const row = f.rows.get(referenceKey("SA2"));
  const result = await Promise.all([
    f.catalog.refresh({ ...row }),
    f.catalog.refresh({ ...row }),
  ]);
  expect(result.sort()).toEqual(["skipped", "updated"]);
  expect(f.source.meetings).toHaveBeenCalledTimes(1);
  f.advance(6 * 3600000);
  row.leaseUntil = new Date("2026-09-21T01:00:00Z");
  expect(await f.catalog.refresh({ ...row })).toBe("updated");
});

test("reject unknown meetings and invalid keys without creating arbitrary entries", async () => {
  const f = fixture();
  await expect(f.catalog.read("SA2", "madeup")).rejects.toThrow();
  expect(f.rows.size).toBe(0);
  expect(() => referenceKey("SA2", "../escape")).toThrow();
  expect(() => referenceKey("INVALID")).toThrow();
});

test("empty refresh cannot erase existing meeting data", async () => {
  const f = fixture();
  await f.catalog.sync();
  const before = await f.catalog.read("SA2");
  f.advance(6 * 3600000);
  f.source.meetings.mockResolvedValue({ meetings: [] });
  await f.catalog.sync();
  expect((await f.catalog.read("SA2")).revision).toBe(before.revision);
});
