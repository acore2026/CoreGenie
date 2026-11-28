import type { SystemPromptVariableRecord } from "@coregenie/contracts";
import { api } from "@/utils/api";

export type { SystemPromptVariableRecord };

const SystemPromptVariable = {
  getAll: async function (): Promise<{
    variables: SystemPromptVariableRecord[];
  }> {
    try {
      return await api.get<{ variables: SystemPromptVariableRecord[] }>(
        "/system/prompt-variables"
      );
    } catch (error) {
      console.error("Error fetching system prompt variables:", error);
      return { variables: [] };
    }
  },

  create: async function (
    variable: Partial<SystemPromptVariableRecord> = {}
  ): Promise<{ success: boolean; error?: unknown }> {
    try {
      return await api.post<{ success: boolean; error?: string }>(
        "/system/prompt-variables",
        variable
      );
    } catch (error) {
      console.error("Error creating system prompt variable:", error);
      return { success: false, error };
    }
  },

  update: async function (
    id: number | string,
    variable: Partial<SystemPromptVariableRecord> = {}
  ): Promise<{ success: boolean; error?: unknown }> {
    try {
      return await api.put<{ success: boolean; error?: string }>(
        `/system/prompt-variables/${id}`,
        variable
      );
    } catch (error) {
      console.error("Error updating system prompt variable:", error);
      return { success: false, error };
    }
  },

  delete: async function (
    id: number | string | null = null
  ): Promise<{ success: boolean; error?: unknown }> {
    try {
      if (id === null) return { success: false, error: "ID is required" };
      return await api.delete<{ success: boolean; error?: string }>(
        `/system/prompt-variables/${id}`
      );
    } catch (error) {
      console.error("Error deleting system prompt variable:", error);
      return { success: false, error };
    }
  },
};

export default SystemPromptVariable;
