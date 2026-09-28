import Admin from "@/models/admin";
import { ADMIN_VIEW } from "@/utils/constants";

export const ADMIN_VIEW_CHANGED_EVENT = "admin-view-changed";

let assignedWorkspaceCache = new Map();

export function canUseAdminView(user) {
  return ["admin", "manager"].includes(user?.role);
}

export function adminViewStorageKey(userId) {
  return `${ADMIN_VIEW}:${userId ?? "unknown"}`;
}

export function readAdminView(userId) {
  if (typeof window === "undefined") return true;
  const value = window.localStorage.getItem(adminViewStorageKey(userId));
  return value === null ? true : value === "true";
}

export function writeAdminView(userId, enabled) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(adminViewStorageKey(userId), String(enabled));
  window.dispatchEvent(
    new CustomEvent(ADMIN_VIEW_CHANGED_EVENT, {
      detail: { userId, enabled },
    })
  );
}

export async function assignedAdminWorkspaces(
  userId,
  { refresh = false } = {}
) {
  const cacheKey = String(userId);
  if (!refresh && assignedWorkspaceCache.has(cacheKey))
    return assignedWorkspaceCache.get(cacheKey);

  const workspaces = await Admin.workspaces();
  const assigned = workspaces
    .filter((workspace) =>
      workspace.userIds?.some((id) => Number(id) === Number(userId))
    )
    .map((workspace) => ({ ...workspace, viewerAccess: "manager" }));
  assignedWorkspaceCache.set(cacheKey, assigned);
  return assigned;
}

export function clearAssignedWorkspaceCache(userId) {
  if (userId === undefined) {
    assignedWorkspaceCache = new Map();
    return;
  }
  assignedWorkspaceCache.delete(String(userId));
}
