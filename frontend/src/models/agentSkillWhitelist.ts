import { api, errorMessage } from "@/utils/api";

export type ApprovalMode = "ask" | "always_allow";

type ApprovalModeUpdate =
  | { success: true; mode: ApprovalMode; error?: null }
  | { success: false; error: string };

const AgentSkillWhitelist = {
  APPROVAL_MODES: {
    ASK: "ask" as ApprovalMode,
    ALWAYS_ALLOW: "always_allow" as ApprovalMode,
  },

  getApprovalMode: async (): Promise<{
    success: boolean;
    mode: ApprovalMode;
    error?: string;
  }> => {
    try {
      return await api.get<{
        success: boolean;
        mode: ApprovalMode;
        error?: string;
      }>("/agent-skills/approval-mode");
    } catch (e) {
      return {
        success: false,
        mode: "always_allow",
        error: errorMessage(e),
      };
    }
  },

  setApprovalMode: async (mode: ApprovalMode): Promise<ApprovalModeUpdate> => {
    try {
      return await api.post<ApprovalModeUpdate>("/agent-skills/approval-mode", {
        mode,
      });
    } catch (e) {
      return { success: false, error: errorMessage(e) };
    }
  },

  addToWhitelist: async (
    skillName: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await api.post<{ success: boolean; error?: string }>(
        "/agent-skills/whitelist/add",
        { skillName }
      );
    } catch (e) {
      return { success: false, error: errorMessage(e) };
    }
  },
};

export default AgentSkillWhitelist;
