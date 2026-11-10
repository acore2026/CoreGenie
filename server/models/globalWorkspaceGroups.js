const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");

const LABEL = "global_workspace_groups_v1";
const empty = () => ({ groups: [], assignments: {}, collapsed: {} });
function fail(message) {
  const error = new Error(message);
  error.isWorkspaceSetupError = true;
  return error;
}
async function assertAdmin(client, userId) {
  if (!userId) return; // Authenticated single-user mode has no user record.
  const user = await client.users.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role !== "admin") {
    const error = fail("只有管理员可以修改全局分组。");
    error.statusCode = 403;
    throw error;
  }
}
async function read(client = prisma) {
  const record = await client.system_settings.findUnique({
    where: { label: LABEL },
  });
  return { record, groups: record ? JSON.parse(record.value) : empty() };
}
async function write(client, record, groups) {
  const { validate, empty: emptyPreferences } = require("./sidebarPreferences");
  validate({ ...emptyPreferences(), groups });
  if (record) {
    const result = await client.system_settings.updateMany({
      where: { label: LABEL, value: record.value },
      data: { value: JSON.stringify(groups), lastUpdatedAt: new Date() },
    });
    if (!result.count) throw fail("全局分组正在更新，请重试。");
  } else
    await client.system_settings.create({
      data: { label: LABEL, value: JSON.stringify(groups) },
    });
}
function add(groups, name, scope) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 40 ||
    !["private", "public"].includes(scope)
  )
    throw fail("分组名称或分类无效。");
  name = name.trim();
  if (
    groups.groups.some(
      (g) =>
        g.scope === scope &&
        g.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
  )
    throw fail("已有同名全局分组，请选择已有分组。");
  const group = { id: `group-${uuidv4()}`, name, scope };
  groups.groups.push(group);
  return group;
}
async function change(userId, operation) {
  return prisma.$transaction(async (tx) => {
    await assertAdmin(tx, userId);
    const { record, groups } = await read(tx);
    if (operation.action === "create") {
      const group = add(groups, operation.name, operation.scope);
      if (operation.workspaceId != null) {
        if (!Number.isSafeInteger(operation.workspaceId))
          throw new Error("工作区选择无效。");
        const workspace = await tx.workspaces.findUnique({
          where: { id: operation.workspaceId },
          select: { id: true, accessMode: true },
        });
        if (
          !workspace ||
          (workspace.accessMode === "private" ? "private" : "public") !==
            group.scope
        )
          throw new Error("工作区分类与分组不一致。");
        groups.assignments[workspace.id] = group.id;
      }
    } else {
      const group = groups.groups.find((g) => g.id === operation.id);
      if (!group) throw new Error("所选全局分组已变化，请刷新后重试。");
      if (operation.action === "rename") {
        const rest = {
          ...groups,
          groups: groups.groups.filter((g) => g.id !== group.id),
        };
        const replacement = add(rest, operation.name, group.scope);
        group.name = replacement.name;
      } else if (operation.action === "move") {
        const ids = operation.workspaceIds;
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 100 ||
          ids.some((id) => !Number.isSafeInteger(id) || id < 1)
        )
          throw new Error("请选择 1 到 100 个工作区。");
        const target = groups.groups.find(
          (item) => item.id === operation.targetGroupId
        );
        if (
          operation.targetGroupId !== group.scope &&
          (!target || target.scope !== group.scope || target.id === group.id)
        )
          throw new Error("请选择同一分类下的其他全局分组。");
        const uniqueIds = [...new Set(ids)];
        const workspaces = await tx.workspaces.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, accessMode: true },
        });
        if (
          workspaces.length !== uniqueIds.length ||
          workspaces.some(
            (workspace) =>
              groups.assignments[workspace.id] !== group.id ||
              (workspace.accessMode === "private" ? "private" : "public") !==
                group.scope
          )
        )
          throw new Error("所选工作区的分组已变化，请刷新后重试。");
        for (const id of uniqueIds) {
          if (target) groups.assignments[id] = target.id;
          else delete groups.assignments[id];
        }
        // The initiating admin should see the move immediately. Preserve other
        // users' choices, and any unrelated personal placement by this admin.
        const { SidebarPreferences } = require("./sidebarPreferences");
        const label = SidebarPreferences.label(userId);
        const personalRecord = await tx.system_settings.findUnique({
          where: { label },
        });
        if (personalRecord) {
          const personal = JSON.parse(personalRecord.value);
          for (const id of uniqueIds)
            if (personal.groups.assignments[id] === group.id)
              delete personal.groups.assignments[id];
          personal.groups.collapsed[group.scope] = false;
          personal.groups.collapsed[operation.targetGroupId] = false;
          const result = await tx.system_settings.updateMany({
            where: { label, value: personalRecord.value },
            data: {
              value: JSON.stringify(personal),
              lastUpdatedAt: new Date(),
            },
          });
          if (!result.count) throw fail("分组正在更新，请重试。");
        }
      } else if (operation.action === "delete") {
        groups.groups = groups.groups.filter((g) => g.id !== group.id);
      } else throw new Error("分组操作无效。");
    }
    await write(tx, record, groups);
    return groups;
  });
}

module.exports = {
  GlobalWorkspaceGroups: { read, write, add, change, assertAdmin },
};
