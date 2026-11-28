import type { WorkspaceRecord } from "@coregenie/contracts";
import { api } from "@/utils/api";
import { type ApiKeyRecord, clearSystemKeysCache } from "./system";

type AnyRecord = Record<string, unknown>;

export interface AdminUser {
  id: number;
  username: string;
  displayName?: string | null;
  employeeNumber?: string | null;
  role: string;
  lastUpdatedAt?: string;
  createdAt?: string;
  authProvider?: string;
  bio?: string | null;
  suspended?: number;
  dailyMessageLimit?: number | null;
}
export interface FeedbackReason {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  enabled: boolean;
}
export interface AdminInvite {
  id: number;
  code: string;
  status: string;
  createdAt: string;
  createdBy?: { username: string } | null;
}
export type AdminWorkspace = WorkspaceRecord & {
  userIds?: (number | string)[];
  accessMode?: string;
  viewerRelation?: string;
};

const Admin = {
  users: async (): Promise<AdminUser[]> => {
    try {
      const res = await api.get<{ users?: AdminUser[] }>("/admin/users");
      return res?.users || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  newUser: async (
    data: AnyRecord
  ): Promise<{ user: AdminUser | null; error?: string | null }> => {
    try {
      return await api.post<{ user: AdminUser | null; error?: string | null }>(
        "/admin/users/new",
        data
      );
    } catch (e) {
      console.error(e);
      return { user: null, error: (e as Error).message };
    }
  },

  updateUser: async (
    userId: number | string,
    data: AnyRecord
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        `/admin/user/${userId}`,
        data
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  deleteUser: async (
    userId: number | string
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.delete<{ success: boolean; error?: string | null }>(
        `/admin/user/${userId}`
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  invites: async (): Promise<AdminInvite[]> => {
    try {
      const res = await api.get<{ invites?: AdminInvite[] }>("/admin/invites");
      return res?.invites || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  newInvite: async ({
    role = null,
    workspaceIds = null,
  }: {
    role?: string | null;
    workspaceIds?: number[] | null;
  } = {}): Promise<{ invite: AdminInvite | null; error?: string | null }> => {
    try {
      return await api.post<{
        invite: AdminInvite | null;
        error?: string | null;
      }>("/admin/invite/new", { role, workspaceIds });
    } catch (e) {
      console.error(e);
      return { invite: null, error: (e as Error).message };
    }
  },

  disableInvite: async (
    inviteId: number | string
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.delete<{ success: boolean; error?: string | null }>(
        `/admin/invite/${inviteId}`
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  workspaces: async (): Promise<AdminWorkspace[]> => {
    try {
      const res = await api.get<{ workspaces?: AdminWorkspace[] }>(
        "/admin/workspaces"
      );
      return res?.workspaces || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  workspaceUsers: async (
    workspaceId: number | string
  ): Promise<AdminUser[]> => {
    try {
      const res = await api.get<{ users?: AdminUser[] }>(
        `/admin/workspaces/${workspaceId}/users`
      );
      return res?.users || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  newWorkspace: async (
    name: string
  ): Promise<{ workspace: AdminWorkspace | null; error?: string | null }> => {
    try {
      return await api.post<{
        workspace: AdminWorkspace | null;
        error?: string | null;
      }>("/admin/workspaces/new", { name });
    } catch (e) {
      console.error(e);
      return { workspace: null, error: (e as Error).message };
    }
  },

  updateUsersInWorkspace: async (
    workspaceId: number | string,
    userIds: number[] = []
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        `/admin/workspaces/${workspaceId}/update-users`,
        { userIds }
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  deleteWorkspace: async (
    workspaceId: number | string
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.delete<{ success: boolean; error?: string | null }>(
        `/admin/workspaces/${workspaceId}`
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  systemPreferencesByFields: async (
    labels: string[] = []
  ): Promise<{
    settings: AnyRecord & {
      global_system_prompt?: string;
      feature_flags?: Record<string, boolean>;
    };
    error?: string | null;
  } | null> => {
    try {
      return await api.get<{
        settings: AnyRecord & {
          global_system_prompt?: string;
          feature_flags?: Record<string, boolean>;
        };
        error?: string | null;
      }>(`/admin/system-preferences-for?labels=${labels.join(",")}`);
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  updateSystemPreferences: async (
    updates: AnyRecord = {}
  ): Promise<{ success: boolean; error?: string | null }> => {
    clearSystemKeysCache();
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        "/admin/system-preferences",
        updates
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  agentFeedbackReasons: async function (): Promise<{
    reasons: FeedbackReason[];
    error?: string | null;
  }> {
    try {
      return await api.get<{
        reasons: FeedbackReason[];
        error?: string | null;
      }>("/admin/agent-feedback/reasons");
    } catch (error) {
      return { reasons: [], error: (error as Error).message };
    }
  },

  createAgentFeedbackReason: async function (
    data: AnyRecord
  ): Promise<{ reason: FeedbackReason | null; error?: string | null }> {
    try {
      return await api.post<{
        reason: FeedbackReason | null;
        error?: string | null;
      }>("/admin/agent-feedback/reasons", data);
    } catch (error) {
      return { reason: null, error: (error as Error).message };
    }
  },

  updateAgentFeedbackReason: async function (
    id: number | string,
    data: AnyRecord
  ): Promise<{ reason: FeedbackReason | null; error?: string | null }> {
    try {
      return await api.patch<{
        reason: FeedbackReason | null;
        error?: string | null;
      }>(`/admin/agent-feedback/reasons/${id}`, data);
    } catch (error) {
      return { reason: null, error: (error as Error).message };
    }
  },

  getApiKeys: async function (): Promise<{
    apiKeys: ApiKeyRecord[];
    error?: string | null;
  }> {
    try {
      return await api.get<{ apiKeys: ApiKeyRecord[]; error?: string | null }>(
        "/admin/api-keys",
        { defaultError: "Error fetching api keys." }
      );
    } catch (e) {
      console.error(e);
      return { apiKeys: [], error: (e as Error).message };
    }
  },

  generateApiKey: async function (
    data: AnyRecord = {}
  ): Promise<{ apiKey: ApiKeyRecord | null; error?: string | null }> {
    try {
      return await api.post<{
        apiKey: ApiKeyRecord | null;
        error?: string | null;
      }>("/admin/generate-api-key", data, {
        defaultError: "Error generating api key.",
      });
    } catch (e) {
      console.error(e);
      return { apiKey: null, error: (e as Error).message };
    }
  },

  deleteApiKey: async function (
    apiKeyId: number | string = ""
  ): Promise<boolean> {
    try {
      await api.delete(`/admin/delete-api-key/${apiKeyId}`);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },
};

export default Admin;
