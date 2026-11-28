import { api, errorMessage } from "@/utils/api";

interface InvitedWorkspace {
  id: number;
  name: string;
  slug: string;
}
export interface InviteRecord {
  code: string;
  status: string;
  workspaces: InvitedWorkspace[];
}
interface CheckInviteResult {
  invite: InviteRecord | null;
  error?: string | null;
}
interface JoinResult {
  success: boolean;
  error?: string | null;
  workspaces?: InvitedWorkspace[];
}
const Invite = {
  checkInvite: async (inviteCode: string): Promise<CheckInviteResult> => {
    try {
      return await api.get<CheckInviteResult>(`/invite/${inviteCode}`, {
        auth: false,
      });
    } catch (e) {
      console.error(e);
      return { invite: null, error: errorMessage(e) };
    }
  },

  acceptInvite: async (
    inviteCode: string,
    newUserInfo: Record<string, unknown> = {}
  ): Promise<JoinResult> => {
    try {
      return await api.post<JoinResult>(`/invite/${inviteCode}`, newUserInfo, {
        auth: false,
      });
    } catch (e) {
      console.error(e);
      return { success: false, error: errorMessage(e) };
    }
  },

  joinWorkspace: async (inviteCode: string): Promise<JoinResult> => {
    try {
      return await api.post<JoinResult>(
        `/invite/${inviteCode}/join`,
        undefined,
        {
          defaultError: "Unable to join workspace.",
        }
      );
    } catch (error) {
      return {
        success: false,
        error: errorMessage(error, "Unable to join workspace."),
      };
    }
  },
};

export default Invite;
