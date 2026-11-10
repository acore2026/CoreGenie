export function visibleOutsideAdminView(workspaces, userId) {
  return workspaces
    .filter(
      (workspace) =>
        workspace.userIds?.some((id) => Number(id) === Number(userId)) ||
        workspace.viewerRelation === "creator" ||
        ["public_readonly", "public_collaborative"].includes(
          workspace.accessMode
        )
    )
    .map((workspace) => ({ ...workspace, viewerAccess: "manager" }));
}
