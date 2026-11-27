import { api, errorMessage } from "@/utils/api";

export interface PublicShareCreateInput {
  workspaceSlug: string;
  threadSlug?: string | null;
}

const PublicChatShare = {
  create: async ({
    workspaceSlug,
    threadSlug = null,
  }: PublicShareCreateInput): Promise<Record<string, unknown>> => {
    try {
      return await api.post<Record<string, unknown>>(
        `/workspace/${encodeURIComponent(workspaceSlug)}/share-chat`,
        { threadSlug },
        { defaultError: "Share failed" }
      );
    } catch (error) {
      return { success: false, error: errorMessage(error, "Share failed") };
    }
  },

  get: async (token: string): Promise<Record<string, unknown>> => {
    try {
      return await api.get<Record<string, unknown>>(
        `/public-chat-share/${encodeURIComponent(token)}`,
        {
          auth: false,
          headers: { Accept: "application/json" },
          defaultError: "Share unavailable",
        }
      );
    } catch (error) {
      return {
        success: false,
        error: errorMessage(error, "Share unavailable"),
      };
    }
  },
};

export default PublicChatShare;
