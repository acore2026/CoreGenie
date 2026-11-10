/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  system_settings: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
}));
const prisma = require("../../utils/prisma");
const {
  SidebarPreferences: prefs,
  empty,
  mergeGroups,
  validate,
} = require("../../models/sidebarPreferences");
let records;
beforeEach(() => {
  jest.resetAllMocks();
  records = new Map();
  prisma.system_settings.findUnique.mockImplementation(
    async ({ where }) => records.get(where.label) || null
  );
  prisma.system_settings.upsert.mockImplementation(
    async ({ where, create }) => {
      if (!records.has(where.label)) records.set(where.label, { ...create });
      return records.get(where.label);
    }
  );
  prisma.system_settings.updateMany.mockImplementation(
    async ({ where, data }) => {
      if (records.get(where.label)?.value !== where.value) return { count: 0 };
      records.set(where.label, { label: where.label, ...data });
      return { count: 1 };
    }
  );
});
it("isolates accounts and imports legacy preferences only once", async () => {
  const first = empty();
  first.favorites.workspaces = [106];
  await prefs.initialize(1, first);
  await prefs.initialize(1, empty());
  await prefs.initialize(2, empty());
  expect((await prefs.get(1)).favorites.workspaces).toEqual([106]);
  expect((await prefs.get(2)).favorites.workspaces).toEqual([]);
  expect(await prefs.get(null)).toBeNull();
});
it("retains concurrent changes and makes repeated favorite requests idempotent", async () => {
  await prefs.initialize(1, empty());
  await Promise.all(
    [106, 107].map((id) =>
      prefs.change(1, {
        type: "favorite",
        kind: "workspaces",
        id,
        selected: true,
      })
    )
  );
  await prefs.change(1, {
    type: "favorite",
    kind: "workspaces",
    id: 106,
    selected: true,
  });
  expect((await prefs.get(1)).favorites.workspaces.sort()).toEqual([106, 107]);
  await prefs.change(1, {
    type: "favorite",
    kind: "workspaces",
    id: 106,
    selected: false,
  });
  expect((await prefs.get(1)).favorites.workspaces).toEqual([107]);
});
it("merges group edits without overwriting another device's groups or assignments", () => {
  const a = { id: "group-a", name: "A", scope: "private" };
  const b = { id: "group-b", name: "B", scope: "public" };
  const before = { groups: [a], assignments: { 1: a.id }, collapsed: {} };
  const remote = {
    groups: [a, b],
    assignments: { 1: a.id, 2: b.id },
    collapsed: { public: true },
  };
  const next = { ...before, groups: [{ ...a, name: "改名" }] };
  const merged = mergeGroups(remote, before, next);
  expect(merged.groups.map((g) => g.name)).toEqual(["改名", "B"]);
  expect(merged.assignments).toEqual(remote.assignments);
  expect(merged.collapsed).toEqual({ public: true });
});
it("removing a group clears assignments while preserving favorites", async () => {
  const initial = empty();
  initial.groups.groups = [{ id: "group-a", name: "A", scope: "private" }];
  initial.groups.assignments = { 106: "group-a" };
  initial.favorites.threads = ["106:default"];
  await prefs.initialize(1, initial);
  const result = await prefs.change(1, {
    type: "groups",
    before: initial.groups,
    next: empty().groups,
  });
  expect(result.groups.assignments).toEqual({});
  expect(result.favorites.threads).toEqual(["106:default"]);
});
it("rejects malformed and oversized state before saving", async () => {
  expect(() => validate({})).toThrow();
  const bad = empty();
  bad.favorites.workspaces = ["106"];
  await expect(prefs.initialize(1, bad)).rejects.toThrow();
  expect(prisma.system_settings.upsert).not.toHaveBeenCalled();
  const huge = empty();
  huge.extra = "x".repeat(200001);
  expect(() => validate(huge)).toThrow();
});

it("imports each old browser once even after another device initialized the account", async () => {
  await prefs.initialize(1, empty());
  const local = empty();
  local.favorites.workspaces = [106];
  const operation = {
    type: "import",
    migrationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    preferences: local,
  };
  await prefs.change(1, operation);
  expect((await prefs.get(1)).favorites.workspaces).toEqual([106]);
  await prefs.change(1, {
    type: "favorite",
    kind: "workspaces",
    id: 106,
    selected: false,
  });
  await prefs.change(1, operation);
  expect((await prefs.get(1)).favorites.workspaces).toEqual([]);
});
