import { api } from "@/utils/api";
import { clearSystemKeysCache } from "./system";

type AnyRecord = Record<string, unknown>;

const Admin = {
  users: async (): Promise<AnyRecord[]> => {
    try {
      const res = await api.get<{ users?: AnyRecord[] }>("/admin/users");
      return res?.users || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  newUser: async (
    data: AnyRecord
  ): Promise<{ user: AnyRecord | null; error?: string | null }> => {
    try {
      return await api.post<{ user: AnyRecord | null; error?: string | null }>(
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

  invites: async (): Promise<AnyRecord[]> => {
    try {
      const res = await api.get<{ invites?: AnyRecord[] }>("/admin/invites");
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
  } = {}): Promise<{ invite: AnyRecord | null; error?: string | null }> => {
    try {
      return await api.post<{
        invite: AnyRecord | null;
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

  workspaces: async (): Promise<AnyRecord[]> => {
    try {
      const res = await api.get<{ workspaces?: AnyRecord[] }>(
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
  ): Promise<AnyRecord[]> => {
    try {
      const res = await api.get<{ users?: AnyRecord[] }>(
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
  ): Promise<{ workspace: AnyRecord | null; error?: string | null }> => {
    try {
      return await api.post<{
        workspace: AnyRecord | null;
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
  ): Promise<{ settings: AnyRecord; error?: string | null } | null> => {
    try {
      return await api.get<{ settings: AnyRecord; error?: string | null }>(
        `/admin/system-preferences-for?labels=${labels.join(",")}`
      );
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
    reasons: AnyRecord[];
    error?: string | null;
  }> {
    try {
      return await api.get<{ reasons: AnyRecord[]; error?: string | null }>(
        "/admin/agent-feedback/reasons"
      );
    } catch (error) {
      return { reasons: [], error: (error as Error).message };
    }
  },

  createAgentFeedbackReason: async function (
    data: AnyRecord
  ): Promise<{ reason: AnyRecord | null; error?: string | null }> {
    try {
      return await api.post<{
        reason: AnyRecord | null;
        error?: string | null;
      }>("/admin/agent-feedback/reasons", data);
    } catch (error) {
      return { reason: null, error: (error as Error).message };
    }
  },

  updateAgentFeedbackReason: async function (
    id: number | string,
    data: AnyRecord
  ): Promise<{ reason: AnyRecord | null; error?: string | null }> {
    try {
      return await api.patch<{
        reason: AnyRecord | null;
        error?: string | null;
      }>(`/admin/agent-feedback/reasons/${id}`, data);
    } catch (error) {
      return { reason: null, error: (error as Error).message };
    }
  },

  getApiKeys: async function (): Promise<{
    apiKeys: AnyRecord[];
    error?: string | null;
  }> {
    try {
      return await api.get<{ apiKeys: AnyRecord[]; error?: string | null }>(
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
  ): Promise<{ apiKey: AnyRecord | null; error?: string | null }> {
    try {
      return await api.post<{
        apiKey: AnyRecord | null;
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
