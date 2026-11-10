const prisma = require("../utils/prisma");

const empty = () => ({
  groups: { groups: [], assignments: {}, collapsed: {} },
  favorites: { workspaces: [], threads: [] },
});
function validate(value, sharedGroups = []) {
  const fail = () => {
    throw new Error("分组或收藏设置无效。");
  };
  if (!value || JSON.stringify(value).length > 200000) fail();
  const { groups: g, favorites: f } = value;
  if (
    !g ||
    !f ||
    !Array.isArray(g.groups) ||
    g.groups.length > 500 ||
    !Array.isArray(f.workspaces) ||
    !Array.isArray(f.threads) ||
    !g.assignments ||
    !g.collapsed
  )
    fail();
  for (const group of g.groups)
    if (
      !group ||
      !/^group-[\w-]+$/.test(group.id) ||
      !["private", "public"].includes(group.scope) ||
      typeof group.name !== "string" ||
      !group.name.trim() ||
      group.name.length > 40 ||
      sharedGroups.some((shared) => shared.id === group.id)
    )
      fail();
  if (new Set(g.groups.map((g) => g.id)).size !== g.groups.length) fail();
  if (
    f.workspaces.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    f.threads.some((id) => typeof id !== "string" || !/^\d+:.{1,240}$/.test(id))
  )
    fail();
  if (
    Object.entries(g.assignments).some(
      ([id, group]) => !/^\d+$/.test(id) || typeof group !== "string"
    ) ||
    Object.entries(g.collapsed).some(
      ([id, state]) =>
        !/^(private|public|group-[\w-]+)$/.test(id) ||
        typeof state !== "boolean"
    )
  )
    fail();
  g.assignments = Object.fromEntries(
    Object.entries(g.assignments).filter(
      ([, id]) =>
        ["private", "public"].includes(id) ||
        [...g.groups, ...sharedGroups].some((g) => g.id === id)
    )
  );
  return value;
}

// Merge only fields changed by this browser. Unrelated changes on another device survive.
function mergeGroups(current, before, next) {
  const result = JSON.parse(JSON.stringify(current));
  const old = new Map(before.groups.map((g) => [g.id, g]));
  const incoming = new Map(next.groups.map((g) => [g.id, g]));
  result.groups = result.groups.filter(
    (g) => !old.has(g.id) || incoming.has(g.id)
  );
  for (const group of next.groups) {
    if (JSON.stringify(old.get(group.id)) === JSON.stringify(group)) continue;
    const index = result.groups.findIndex((g) => g.id === group.id);
    if (index < 0) result.groups.push(group);
    else result.groups[index] = group;
  }
  for (const field of ["assignments", "collapsed"])
    for (const key of new Set([
      ...Object.keys(before[field]),
      ...Object.keys(next[field]),
    ])) {
      if (before[field][key] === next[field][key]) continue;
      if (Object.hasOwn(next[field], key))
        result[field][key] = next[field][key];
      else delete result[field][key];
    }
  return result;
}

const SidebarPreferences = {
  label(userId) {
    return `sidebar_preferences_v1:${userId ?? "single-user"}`;
  },
  async get(userId) {
    const record = await prisma.system_settings.findUnique({
      where: { label: this.label(userId) },
    });
    return record ? JSON.parse(record.value) : null;
  },
  async initialize(userId, value) {
    const { GlobalWorkspaceGroups } = require("./globalWorkspaceGroups");
    const shared = (await GlobalWorkspaceGroups.read()).groups.groups;
    validate(value, shared);
    const record = await prisma.system_settings.upsert({
      where: { label: this.label(userId) },
      create: { label: this.label(userId), value: JSON.stringify(value) },
      update: {},
    });
    return JSON.parse(record.value);
  },
  async change(userId, operation) {
    const { GlobalWorkspaceGroups } = require("./globalWorkspaceGroups");
    const shared = (await GlobalWorkspaceGroups.read()).groups.groups;
    if (
      !operation ||
      !["groups", "favorite", "import"].includes(operation.type)
    )
      throw new Error("设置操作无效。");
    if (operation.type === "import") {
      validate(operation.preferences, shared);
      if (
        typeof operation.migrationId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(operation.migrationId)
      )
        throw new Error("旧设置标识无效。");
    } else if (operation.type === "groups") {
      validate({ ...empty(), groups: operation.before }, shared);
      validate({ ...empty(), groups: operation.next }, shared);
    } else if (
      !["workspaces", "threads"].includes(operation.kind) ||
      typeof operation.selected !== "boolean"
    ) {
      throw new Error("收藏设置无效。");
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const label = this.label(userId);
      const record = await prisma.system_settings.findUnique({
        where: { label },
      });
      if (!record) throw new Error("请刷新后重试。");
      const value = JSON.parse(record.value);
      if (operation.type === "import") {
        const imported = value.imported || [];
        if (imported.includes(operation.migrationId)) return value;
        if (imported.length >= 1000) throw new Error("旧设置导入次数过多。");
        const local = operation.preferences;
        value.groups.groups.push(
          ...local.groups.groups.filter(
            (g) => !value.groups.groups.some((existing) => existing.id === g.id)
          )
        );
        value.groups.assignments = {
          ...local.groups.assignments,
          ...value.groups.assignments,
        };
        value.groups.collapsed = {
          ...local.groups.collapsed,
          ...value.groups.collapsed,
        };
        for (const kind of ["workspaces", "threads"])
          value.favorites[kind] = [
            ...new Set([...value.favorites[kind], ...local.favorites[kind]]),
          ];
        value.imported = [...imported, operation.migrationId];
      } else if (operation.type === "groups")
        value.groups = mergeGroups(
          value.groups,
          operation.before,
          operation.next
        );
      else {
        const items = new Set(value.favorites[operation.kind]);
        if (operation.selected) items.add(operation.id);
        else items.delete(operation.id);
        value.favorites[operation.kind] = [...items];
      }
      validate(value, shared);
      const result = await prisma.system_settings.updateMany({
        where: { label, value: record.value },
        data: { value: JSON.stringify(value), lastUpdatedAt: new Date() },
      });
      if (result.count) return value;
    }
    throw new Error("设置正在其他设备上更新，请重试。");
  },
};
module.exports = { SidebarPreferences, mergeGroups, validate, empty };
