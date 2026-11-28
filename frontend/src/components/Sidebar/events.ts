import type { WorkspaceThreadRecord } from "@coregenie/contracts";
export const THREAD_RENAME_EVENT = "renameThread";
export const THREAD_CREATED_EVENT = "threadCreated";
export const THREAD_DELETED_EVENT = "threadDeleted";
export const WORKSPACE_CREATED_EVENT = "workspaceCreated";
export const WORKSPACE_RENAMED_EVENT = "workspaceRenamed";
export const CLOSE_MOBILE_SIDEBAR_EVENT = "closeMobileSidebar";

declare global {
  interface WindowEventMap {
    [WORKSPACE_RENAMED_EVENT]: CustomEvent<{
      workspaceSlug: string;
      name: string;
    }>;
    [THREAD_RENAME_EVENT]: CustomEvent<{
      workspaceSlug?: string;
      threadSlug: string;
      newName: string;
    }>;
    [THREAD_CREATED_EVENT]: CustomEvent<{
      workspaceSlug: string;
      thread: WorkspaceThreadRecord;
    }>;
    [THREAD_DELETED_EVENT]: CustomEvent<{
      workspaceSlug: string;
      threadSlug: string;
    }>;
  }
}
