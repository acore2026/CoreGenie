import { api, errorMessage } from "@/utils/api";

const Invite = {
  checkInvite: async (
    inviteCode: string
  ): Promise<{ invite: Record<string, unknown> | null; error?: string }> => {
    try {
      return await api.get<{
        invite: Record<string, unknown> | null;
        error?: string;
      }>(`/invite/${inviteCode}`, { auth: false });
    } catch (e) {
      console.error(e);
      return { invite: null, error: errorMessage(e) };
    }
  },

  acceptInvite: async (
    inviteCode: string,
    newUserInfo: Record<string, unknown> = {}
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await api.post<{ success: boolean; error?: string }>(
        `/invite/${inviteCode}`,
        newUserInfo,
        { auth: false }
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: errorMessage(e) };
    }
  },

  joinWorkspace: async (
    inviteCode: string
  ): Promise<{
    success: boolean;
    error?: string;
    workspaceSlug?: string | null;
  }> => {
    try {
      return await api.post<{
        success: boolean;
        error?: string;
        workspaceSlug?: string | null;
      }>(`/invite/${inviteCode}/join`, undefined, {
        defaultError: "Unable to join workspace.",
      });
    } catch (error) {
      return {
        success: false,
        error: errorMessage(error, "Unable to join workspace."),
      };
    }
  },
};

export default Invite;
