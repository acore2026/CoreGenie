const prisma = require("../utils/prisma");
const { v4: uuidv4 } = require("uuid");
const { SidebarPreferences, empty, validate } = require("./sidebarPreferences");
const { GlobalWorkspaceGroups } = require("./globalWorkspaceGroups");

function setupError(message) {
  const error = new Error(message);
  error.isWorkspaceSetupError = true;
  return error;
}

// Only the creation endpoint uses this setup. Existing internal callers keep
// their Workspace.new behavior. All three writes commit together.
async function createWithSetup(data, creatorId, setup) {
  const { groupId = "", groupName = "", groupGlobal = false } = setup;
  // Public workspaces are already visible to all accounts. Hidden selections
  // must not silently grant extra membership privileges.
  const memberIds =
    data.accessMode === "private"
      ? setup.memberIds === undefined
        ? []
        : setup.memberIds
      : [];
  if (
    !Array.isArray(memberIds) ||
    memberIds.length > 100 ||
    memberIds.some((id) => !Number.isSafeInteger(id) || id < 1)
  )
    throw setupError("成员选择无效，最多可以添加 100 人。");
  if (!creatorId && memberIds.length)
    throw setupError("添加成员需要登录用户账号。");
  if (
    typeof groupId !== "string" ||
    typeof groupName !== "string" ||
    typeof groupGlobal !== "boolean" ||
    (groupGlobal && (!groupName.trim() || groupId)) ||
    (groupId && !/^group-[\w-]+$/.test(groupId)) ||
    groupName.trim().length > 40 ||
    (groupId && groupName.trim())
  )
    throw setupError("分组选择无效。");
  const name = groupName.trim();
  const scope = data.accessMode === "private" ? "private" : "public";
  const ids = [...new Set([...memberIds, ...(creatorId ? [creatorId] : [])])];
  return prisma.$transaction(async (tx) => {
    const shared = await GlobalWorkspaceGroups.read(tx);
    if (groupGlobal) await GlobalWorkspaceGroups.assertAdmin(tx, creatorId);
    if (memberIds.length) {
      const users = await tx.users.findMany({
        where: { id: { in: [...new Set(memberIds)] }, suspended: 0 },
        select: { id: true },
      });
      if (users.length !== new Set(memberIds).size)
        throw setupError("部分成员已停用或不存在，请重新选择。");
    }
    let record;
    let preferences;
    let group;
    let sharedAssignment = false;
    const label = SidebarPreferences.label(creatorId);
    if (groupId || name) {
      record = await tx.system_settings.findUnique({ where: { label } });
      preferences = record ? JSON.parse(record.value) : empty();
      if (groupId) {
        group = shared.groups.groups.find(
          (item) => item.id === groupId && item.scope === scope
        );
        if (group) {
          const creator = creatorId
            ? await tx.users.findUnique({
                where: { id: creatorId },
                select: { role: true },
              })
            : null;
          sharedAssignment = !creatorId || creator?.role === "admin";
        } else
          group = preferences.groups.groups.find(
            (item) => item.id === groupId && item.scope === scope
          );
        if (!group) throw setupError("所选分组已变化，请重新选择。");
      } else if (groupGlobal) {
        group = GlobalWorkspaceGroups.add(shared.groups, name, scope);
        sharedAssignment = true;
      } else {
        if (
          [...preferences.groups.groups, ...shared.groups.groups].some(
            (item) =>
              item.scope === scope &&
              item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          )
        )
          throw setupError("已有同名分组，请选择已有分组。");
        if (preferences.groups.groups.length >= 500)
          throw setupError("分组数量已达上限。");
        group = { id: `group-${uuidv4()}`, scope, name };
        preferences.groups.groups.push(group);
      }
    }
    const workspace = await tx.workspaces.create({ data });
    for (const id of ids)
      await tx.workspace_users.create({
        data: { user_id: id, workspace_id: workspace.id },
      });
    if (group) {
      if (sharedAssignment) {
        shared.groups.assignments[workspace.id] = group.id;
        await GlobalWorkspaceGroups.write(tx, shared.record, shared.groups);
        return workspace;
      }
      preferences.groups.assignments[workspace.id] = group.id;
      preferences.groups.collapsed[scope] = false;
      preferences.groups.collapsed[group.id] = false;
      validate(preferences, shared.groups.groups);
      if (record) {
        const result = await tx.system_settings.updateMany({
          where: { label, value: record.value },
          data: {
            value: JSON.stringify(preferences),
            lastUpdatedAt: new Date(),
          },
        });
        if (!result.count) throw setupError("分组正在其他设备上更新，请重试。");
      } else
        await tx.system_settings.create({
          data: { label, value: JSON.stringify(preferences) },
        });
    }
    return workspace;
  });
}

async function creationMembers(userId) {
  return prisma.users.findMany({
    where: { suspended: 0, id: { not: userId } },
    select: {
      id: true,
      username: true,
      displayName: true,
      employeeNumber: true,
    },
    orderBy: { username: "asc" },
  });
}

module.exports = { createWithSetup, creationMembers };
