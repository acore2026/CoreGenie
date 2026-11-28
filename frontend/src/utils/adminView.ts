import Admin from "@/models/admin";
import { ADMIN_VIEW } from "@/utils/constants";
import { visibleOutsideAdminView } from "./adminWorkspaceVisibility.ts";

export const ADMIN_VIEW_CHANGED_EVENT = "admin-view-changed";

type UserId = number | string | undefined | null;
const assignedWorkspaceCache = new Map<
  string,
  Awaited<ReturnType<typeof Admin.workspaces>>
>();

export function canUseAdminView(user?: { role?: string } | null) {
  return ["admin", "manager"].includes(user?.role ?? "");
}

export function adminViewStorageKey(userId?: UserId) {
  return `${ADMIN_VIEW}:${userId ?? "unknown"}`;
}

export function readAdminView(userId?: UserId) {
  if (typeof window === "undefined") return true;
  const value = window.localStorage.getItem(adminViewStorageKey(userId));
  return value === null ? true : value === "true";
}

export function writeAdminView(userId: UserId, enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(adminViewStorageKey(userId), String(enabled));
  window.dispatchEvent(
    new CustomEvent(ADMIN_VIEW_CHANGED_EVENT, {
      detail: { userId, enabled },
    })
  );
}

export async function assignedAdminWorkspaces(
  userId: UserId,
  { refresh = false } = {}
) {
  const cacheKey = String(userId);
  const cached = assignedWorkspaceCache.get(cacheKey);
  if (!refresh && cached) return cached;

  const workspaces = await Admin.workspaces();
  const assigned = visibleOutsideAdminView(workspaces, userId);
  assignedWorkspaceCache.set(cacheKey, assigned);
  return assigned;
}

export function clearAssignedWorkspaceCache(userId?: UserId) {
  if (userId === undefined) {
    assignedWorkspaceCache.clear();
    return;
  }
  assignedWorkspaceCache.delete(String(userId));
}
