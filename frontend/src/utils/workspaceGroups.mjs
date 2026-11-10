export const GROUP_SCOPES = ["private", "public"];

export const groupDropTargetId = (id) => `group-target:${id}`;
export function groupDropDestination(destination) {
  return destination
    ? {
        ...destination,
        droppableId: destination.droppableId.replace(/^group-target:/, ""),
      }
    : null;
}

export function assignWorkspaceGroups(
  settings,
  workspaces,
  workspaceIds,
  targetId
) {
  const target = settings.groups.find((group) => group.id === targetId);
  const scope = target?.scope || targetId;
  if (
    !GROUP_SCOPES.includes(scope) ||
    !workspaceIds.length ||
    workspaceIds.length > 100
  )
    return null;
  const rows = workspaceIds.map((id) =>
    workspaces.find((workspace) => workspace.id === id)
  );
  if (
    rows.some((workspace) => !workspace || workspaceScope(workspace) !== scope)
  )
    return null;
  const assignments = { ...settings.assignments };
  for (const id of workspaceIds) {
    if (target) assignments[id] = target.id;
    else delete assignments[id];
  }
  return {
    ...settings,
    assignments,
    collapsed: { ...settings.collapsed, [scope]: false, [targetId]: false },
  };
}

export function effectiveWorkspaceGroups(personal, shared) {
  return {
    groups: [
      ...(shared?.groups || []).map((group) => ({ ...group, global: true })),
      ...personal.groups,
    ],
    assignments: { ...shared?.assignments, ...personal.assignments },
    collapsed: personal.collapsed,
  };
}

// Save only this user's changes; shared defaults remain live for everyone.
export function personalWorkspaceGroups(personal, before, next, shared) {
  const assignments = { ...personal.assignments };
  for (const id of new Set([
    ...Object.keys(before.assignments),
    ...Object.keys(next.assignments),
  ])) {
    if (before.assignments[id] === next.assignments[id]) continue;
    if (Object.hasOwn(next.assignments, id))
      assignments[id] = next.assignments[id];
    else if (shared?.assignments?.[id]) {
      assignments[id] =
        shared.groups.find((group) => group.id === shared.assignments[id])
          ?.scope || "private";
    } else delete assignments[id];
  }
  return {
    groups: next.groups.filter((group) => !group.global),
    assignments,
    collapsed: next.collapsed,
  };
}

export function workspaceScope(workspace) {
  return ["public_readonly", "public_collaborative"].includes(
    workspace.accessMode
  )
    ? "public"
    : "private";
}

export function workspaceGroupsKey(userId) {
  return `workspace-groups:v1:${userId ?? "single-user"}`;
}

export function normalizeWorkspaceGroups(value) {
  const groups = [];
  for (const group of Array.isArray(value?.groups) ? value.groups : []) {
    if (
      typeof group?.id !== "string" ||
      !/^group-[\w-]+$/.test(group.id) ||
      !GROUP_SCOPES.includes(group.scope) ||
      typeof group.name !== "string" ||
      !group.name.trim() ||
      groups.some((item) => item.id === group.id)
    )
      continue;
    groups.push({
      id: group.id,
      scope: group.scope,
      name: group.name.trim().slice(0, 40),
      ...(group.global ? { global: true } : {}),
    });
  }
  const assignments = Object.fromEntries(
    Object.entries(value?.assignments || {}).filter(
      ([id, groupId]) =>
        /^\d+$/.test(id) &&
        (GROUP_SCOPES.includes(groupId) ||
          groups.some((group) => group.id === groupId))
    )
  );
  const collapsed = Object.fromEntries(
    Object.entries(value?.collapsed || {}).filter(
      ([id, state]) =>
        typeof state === "boolean" &&
        (GROUP_SCOPES.includes(id) || groups.some((group) => group.id === id))
    )
  );
  return { groups, assignments, collapsed };
}

export function workspaceGroupId(workspace, settings) {
  const scope = workspaceScope(workspace);
  return (
    settings.groups.find(
      (group) =>
        group.id === settings.assignments[workspace.id] && group.scope === scope
    )?.id || scope
  );
}

export function removeWorkspaceGroup(settings, groupId) {
  return normalizeWorkspaceGroups({
    ...settings,
    groups: settings.groups.filter((group) => group.id !== groupId),
  });
}

// DnD indices are local to one visible group, never the entire workspace list.
export function moveGroupedWorkspace(
  workspaces,
  settings,
  source,
  destination
) {
  const target = settings.groups.find(
    (group) => group.id === destination.droppableId
  );
  const scope = target?.scope || destination.droppableId;
  const sourceRows = workspaces.filter(
    (workspace) => workspaceGroupId(workspace, settings) === source.droppableId
  );
  const moving = sourceRows[source.index];
  if (!moving || workspaceScope(moving) !== scope) return null;
  const nextSettings = assignWorkspaceGroups(
    settings,
    workspaces,
    [moving.id],
    destination.droppableId
  );
  if (!nextSettings) return null;
  const remaining = workspaces.filter(
    (workspace) => workspace.id !== moving.id
  );
  const targetRows = remaining.filter(
    (workspace) =>
      workspaceGroupId(workspace, nextSettings) === destination.droppableId
  );
  const before = targetRows[destination.index];
  const last = targetRows.at(-1);
  const index = before
    ? remaining.indexOf(before)
    : last
      ? remaining.indexOf(last) + 1
      : remaining.length;
  remaining.splice(index, 0, moving);
  return { workspaces: remaining, settings: nextSettings };
}
