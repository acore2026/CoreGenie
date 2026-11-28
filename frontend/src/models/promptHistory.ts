import type { PromptHistoryEntry } from "@coregenie/contracts";
import { api } from "@/utils/api";

export type { PromptHistoryEntry };

const PromptHistory = {
  forWorkspace: async function (
    workspaceId: number | string
  ): Promise<PromptHistoryEntry[]> {
    try {
      const res = await api.get<{ history?: PromptHistoryEntry[] }>(
        `/workspace/${workspaceId}/prompt-history`
      );
      return res.history || [];
    } catch (error) {
      console.error("Error fetching prompt history:", error);
      return [];
    }
  },

  clearAll: async function (
    workspaceId: number | string
  ): Promise<{ success: boolean; error?: unknown }> {
    try {
      return await api.delete<{ success: boolean; error?: string }>(
        `/workspace/${workspaceId}/prompt-history`
      );
    } catch (error) {
      console.error("Error clearing prompt history:", error);
      return { success: false, error };
    }
  },

  delete: async function (
    id: number | string
  ): Promise<{ success: boolean; error?: unknown }> {
    try {
      return await api.delete<{ success: boolean; error?: string }>(
        `/workspace/prompt-history/${id}`
      );
    } catch (error) {
      console.error("Error deleting prompt history:", error);
      return { success: false, error };
    }
  },
};

export default PromptHistory;
