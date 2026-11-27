/* eslint-env jest, node */
const { createPgliteTestDb } = require("../helpers/pgliteTestDb");
let testDb;
let mockPrisma;
jest.mock(
  "../../utils/prisma",
  () =>
    new Proxy(
      {},
      {
        get: (_, key) => {
          const value = mockPrisma[key];
          return typeof value === "function" ? value.bind(mockPrisma) : value;
        },
      }
    )
);
const {
  createWithSetup,
  creationMembers,
} = require("../../models/workspaceCreation");
const {
  SidebarPreferences,
  empty,
} = require("../../models/sidebarPreferences");
const { GlobalWorkspaceGroups } = require("../../models/globalWorkspaceGroups");
const data = (accessMode = "private") => ({
  name: "提案分析",
  slug: "proposals",
  chatMode: "automatic",
  accessMode,
});

beforeAll(async () => {
  testDb = await createPgliteTestDb();
  mockPrisma = testDb.prisma;
  await mockPrisma.users.createMany({
    data: [
      {
        id: 1,
        username: "owner",
        password: "secret",
        displayName: "创建者",
        employeeNumber: "001",
        suspended: 0,
      },
      {
        id: 2,
        username: "member",
        password: "secret",
        displayName: "同事",
        employeeNumber: "002",
        suspended: 0,
      },
      {
        id: 3,
        username: "disabled",
        password: "secret",
        displayName: "停用用户",
        employeeNumber: "003",
        suspended: 1,
      },
      {
        id: 4,
        username: "other",
        password: "secret",
        displayName: "另一同事",
        employeeNumber: "004",
        suspended: 0,
      },
    ],
  });
}, 30000);
beforeEach(async () => {
  await mockPrisma.workspace_users.deleteMany();
  await mockPrisma.workspaces.deleteMany();
  await mockPrisma.system_settings.deleteMany();
  await mockPrisma.users.updateMany({ data: { role: "default" } });
});
afterAll(async () => {
  await testDb?.close();
});

it.each(["private", "public_readonly", "public_collaborative"])(
  "creates %s with the creator and unique selected members",
  async (mode) => {
    const workspace = await createWithSetup(data(mode), 1, {
      memberIds: [2, 2, 1],
    });
    expect(workspace.accessMode).toBe(mode);
    const rows = await mockPrisma.workspace_users.findMany({
      where: { workspace_id: workspace.id },
    });
    expect(rows.map((row) => row.user_id).sort()).toEqual(
      mode === "private" ? [1, 2] : [1]
    );
  }
);
it("creates a personal group and membership with the workspace, leaving other accounts unchanged", async () => {
  await SidebarPreferences.initialize(4, empty());
  const workspace = await createWithSetup(data(), 1, {
    memberIds: [2],
    groupName: "标准研究",
  });
  const prefs = await SidebarPreferences.get(1);
  expect(prefs.groups.groups).toEqual([
    expect.objectContaining({ name: "标准研究", scope: "private" }),
  ]);
  expect(prefs.groups.assignments[workspace.id]).toBe(
    prefs.groups.groups[0].id
  );
  expect(await SidebarPreferences.get(4)).toEqual(empty());
});
it("assigns an existing public group while preserving favorites and other assignments", async () => {
  const prefs = empty();
  prefs.groups.groups = [{ id: "group-a", scope: "public", name: "公开项目" }];
  prefs.groups.assignments[900] = "group-a";
  prefs.favorites.workspaces = [900];
  await SidebarPreferences.initialize(1, prefs);
  const workspace = await createWithSetup(data("public_readonly"), 1, {
    groupId: "group-a",
  });
  const saved = await SidebarPreferences.get(1);
  expect(saved.groups.assignments).toEqual({
    900: "group-a",
    [workspace.id]: "group-a",
  });
  expect(saved.favorites).toEqual(prefs.favorites);
});
it.each([
  { memberIds: [3] },
  { memberIds: [999] },
  { memberIds: ["2"] },
  { memberIds: null },
  { memberIds: Array(101).fill(2) },
  { groupName: "x".repeat(41) },
])("rejects invalid setup without creating anything: %j", async (setup) => {
  await expect(createWithSetup(data(), 1, setup)).rejects.toThrow();
  expect(await mockPrisma.workspaces.count()).toBe(0);
  expect(await mockPrisma.workspace_users.count()).toBe(0);
});
it("cannot assign another user's group or a group in the wrong scope", async () => {
  const prefs = empty();
  prefs.groups.groups = [{ id: "group-a", scope: "public", name: "公开项目" }];
  await SidebarPreferences.initialize(4, prefs);
  await expect(
    createWithSetup(data("public_readonly"), 1, { groupId: "group-a" })
  ).rejects.toThrow("分组");
  await SidebarPreferences.initialize(1, prefs);
  await expect(
    createWithSetup(data(), 1, { groupId: "group-a" })
  ).rejects.toThrow("分组");
  expect(await mockPrisma.workspaces.count()).toBe(0);
});
it("rejects duplicate names in the same scope", async () => {
  const prefs = empty();
  prefs.groups.groups = [{ id: "group-a", scope: "private", name: "标准研究" }];
  await SidebarPreferences.initialize(1, prefs);
  await expect(
    createWithSetup(data(), 1, { groupName: " 标准研究 " })
  ).rejects.toThrow("同名");
});
it("rolls back workspace and members if saving the group fails", async () => {
  // Existing sidebar data exceeds the allowed size; validation happens after
  // workspace/member writes, exercising actual transaction rollback.
  const prefs = empty();
  prefs.extra = "x".repeat(200001);
  await mockPrisma.system_settings.create({
    data: { label: SidebarPreferences.label(1), value: JSON.stringify(prefs) },
  });
  await expect(
    createWithSetup(data(), 1, { memberIds: [2], groupName: "研究" })
  ).rejects.toThrow();
  expect(await mockPrisma.workspaces.count()).toBe(0);
  expect(await mockPrisma.workspace_users.count()).toBe(0);
  expect(await SidebarPreferences.get(1)).toEqual(prefs);
});
it("lists only active colleagues, excluding the creator and private account fields", async () => {
  const members = await creationMembers(1);
  expect(members.map((member) => member.id)).toEqual([2, 4]);
  expect(Object.keys(members[0]).sort()).toEqual([
    "displayName",
    "employeeNumber",
    "id",
    "username",
  ]);
});
it("supports single-user creation and personal grouping, but cannot add members without an account", async () => {
  await expect(
    createWithSetup(data(), null, { memberIds: [2] })
  ).rejects.toThrow("登录");
  const workspace = await createWithSetup(data(), null, { groupName: "资料" });
  expect(
    (await SidebarPreferences.get(null)).groups.assignments[workspace.id]
  ).toBeDefined();
  expect(await mockPrisma.workspace_users.count()).toBe(0);
});
it("creates a global group and default assignment atomically without copying it into personal settings", async () => {
  await mockPrisma.users.update({
    where: { id: 1 },
    data: { role: "admin" },
    select: { id: true },
  });
  const workspace = await createWithSetup(data("public_readonly"), 1, {
    groupName: "会议资料",
    groupGlobal: true,
    memberIds: [2],
  });
  const shared = (await GlobalWorkspaceGroups.read()).groups;
  expect(shared.groups).toEqual([
    expect.objectContaining({ name: "会议资料", scope: "public" }),
  ]);
  expect(shared.assignments[workspace.id]).toBe(shared.groups[0].id);
  expect(await SidebarPreferences.get(1)).toBeNull();
  expect(await SidebarPreferences.get(2)).toBeNull();
  expect(await mockPrisma.workspace_users.count()).toBe(1);
});
it("ordinary users cannot create, rename or delete global groups", async () => {
  await expect(
    createWithSetup(data(), 2, { groupName: "全局", groupGlobal: true })
  ).rejects.toThrow("管理员");
  await expect(
    GlobalWorkspaceGroups.change(2, {
      action: "create",
      name: "全局",
      scope: "private",
    })
  ).rejects.toThrow("管理员");
  expect(await mockPrisma.workspaces.count()).toBe(0);
  expect((await GlobalWorkspaceGroups.read()).groups.groups).toEqual([]);
  await mockPrisma.users.update({
    where: { id: 1 },
    data: { role: "admin" },
    select: { id: true },
  });
  const shared = await GlobalWorkspaceGroups.change(1, {
    action: "create",
    name: "全局",
    scope: "private",
  });
  for (const action of ["rename", "delete"])
    await expect(
      GlobalWorkspaceGroups.change(2, {
        action,
        id: shared.groups[0].id,
        name: "篡改",
      })
    ).rejects.toThrow("管理员");
  expect((await GlobalWorkspaceGroups.read()).groups.groups[0].name).toBe(
    "全局"
  );
});
it("admin group changes reach all readers and duplicate creation rolls back the workspace", async () => {
  await mockPrisma.users.update({
    where: { id: 1 },
    data: { role: "admin" },
    select: { id: true },
  });
  const original = await GlobalWorkspaceGroups.change(1, {
    action: "create",
    name: "会议资料",
    scope: "public",
  });
  const id = original.groups[0].id;
  await expect(
    createWithSetup(data("public_readonly"), 1, {
      groupName: "会议资料",
      groupGlobal: true,
    })
  ).rejects.toThrow("同名");
  expect(await mockPrisma.workspaces.count()).toBe(0);
  await GlobalWorkspaceGroups.change(1, {
    action: "rename",
    id,
    name: "SA2 会议",
  });
  expect((await GlobalWorkspaceGroups.read()).groups.groups[0]).toMatchObject({
    id,
    name: "SA2 会议",
  });
  await GlobalWorkspaceGroups.change(1, { action: "delete", id });
  expect((await GlobalWorkspaceGroups.read()).groups.groups).toEqual([]);
});
it("ordinary users can use global groups personally without modifying shared assignments", async () => {
  await mockPrisma.users.update({
    where: { id: 1 },
    data: { role: "admin" },
    select: { id: true },
  });
  const shared = await GlobalWorkspaceGroups.change(1, {
    action: "create",
    name: "资料",
    scope: "private",
  });
  const id = shared.groups[0].id;
  const workspace = await createWithSetup(data(), 2, { groupId: id });
  expect(
    (await SidebarPreferences.get(2)).groups.assignments[workspace.id]
  ).toBe(id);
  await SidebarPreferences.change(2, {
    type: "favorite",
    kind: "workspaces",
    id: workspace.id,
    selected: true,
  });
  expect(
    (await SidebarPreferences.get(2)).groups.assignments[workspace.id]
  ).toBe(id);
  expect((await GlobalWorkspaceGroups.read()).groups.assignments).toEqual({});
});
it("moves global workspace assignments atomically without changing memberships or access", async () => {
  await mockPrisma.users.update({
    where: { id: 1 },
    data: { role: "admin" },
    select: { id: true },
  });
  const shared = await GlobalWorkspaceGroups.change(1, {
    action: "create",
    name: "原分组",
    scope: "private",
  });
  const source = shared.groups[0].id;
  const next = await GlobalWorkspaceGroups.change(1, {
    action: "create",
    name: "目标分组",
    scope: "private",
  });
  const target = next.groups[1].id;
  const workspace = await createWithSetup(data(), 1, {
    groupId: source,
    memberIds: [2],
  });
  const operation = {
    action: "move",
    id: source,
    targetGroupId: target,
    workspaceIds: [workspace.id],
  };
  const personal = empty();
  personal.groups.assignments[workspace.id] = source;
  personal.groups.collapsed[target] = true;
  personal.favorites.workspaces = [workspace.id];
  await SidebarPreferences.initialize(1, personal);
  await SidebarPreferences.initialize(2, JSON.parse(JSON.stringify(personal)));
  await expect(GlobalWorkspaceGroups.change(2, operation)).rejects.toThrow(
    "管理员"
  );
  await expect(
    GlobalWorkspaceGroups.change(1, {
      ...operation,
      workspaceIds: [workspace.id, 999],
    })
  ).rejects.toThrow("已变化");
  expect(
    (await GlobalWorkspaceGroups.read()).groups.assignments[workspace.id]
  ).toBe(source);
  await GlobalWorkspaceGroups.change(1, operation);
  expect(
    (await GlobalWorkspaceGroups.read()).groups.assignments[workspace.id]
  ).toBe(target);
  const adminPreferences = await SidebarPreferences.get(1);
  expect(adminPreferences.groups.assignments[workspace.id]).toBeUndefined();
  expect(adminPreferences.groups.collapsed[target]).toBe(false);
  expect(adminPreferences.favorites.workspaces).toEqual([workspace.id]);
  expect(
    (await SidebarPreferences.get(2)).groups.assignments[workspace.id]
  ).toBe(source);
  expect(
    (
      await mockPrisma.workspaces.findUnique({
        where: { id: workspace.id },
        select: { accessMode: true },
      })
    ).accessMode
  ).toBe("private");
  expect(await mockPrisma.workspace_users.count()).toBe(2);
  await expect(GlobalWorkspaceGroups.change(1, operation)).rejects.toThrow(
    "已变化"
  );
  await GlobalWorkspaceGroups.change(1, {
    ...operation,
    id: target,
    targetGroupId: "private",
  });
  expect(
    (await GlobalWorkspaceGroups.read()).groups.assignments[workspace.id]
  ).toBeUndefined();
});
it("cannot move a global workspace across public/private scopes or into a personal group", async () => {
  await mockPrisma.users.update({
    where: { id: 1 },
    data: { role: "admin" },
    select: { id: true },
  });
  const shared = await GlobalWorkspaceGroups.change(1, {
    action: "create",
    name: "私有分组",
    scope: "private",
  });
  const source = shared.groups[0].id;
  const next = await GlobalWorkspaceGroups.change(1, {
    action: "create",
    name: "公共分组",
    scope: "public",
  });
  const target = next.groups[1].id;
  const workspace = await createWithSetup(data(), 1, { groupId: source });
  for (const targetGroupId of [target, "public", "group-personal"])
    await expect(
      GlobalWorkspaceGroups.change(1, {
        action: "move",
        id: source,
        targetGroupId,
        workspaceIds: [workspace.id],
      })
    ).rejects.toThrow("同一分类");
  expect(
    (await GlobalWorkspaceGroups.read()).groups.assignments[workspace.id]
  ).toBe(source);
});
