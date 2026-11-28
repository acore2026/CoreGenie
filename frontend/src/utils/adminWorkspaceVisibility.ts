export function visibleOutsideAdminView<
  T extends {
    userIds?: (number | string)[];
    viewerRelation?: string;
    accessMode?: string;
  },
>(workspaces: T[], userId?: string | number | null) {
  return workspaces
    .filter(
      (workspace) =>
        workspace.userIds?.some((id) => Number(id) === Number(userId)) ||
        workspace.viewerRelation === "creator" ||
        ["public_readonly", "public_collaborative"].includes(
          workspace.accessMode ?? ""
        )
    )
    .map((workspace) => ({ ...workspace, viewerAccess: "manager" }));
}
