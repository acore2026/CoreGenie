import { api, errorMessage } from "@/utils/api";

import type { CitationChunk, ContextTrace } from "@/utils/chat/messages";
export interface SharedSource extends CitationChunk {
  url?: string;
  name?: string;
}
export interface SharedMessage {
  chatId?: number;
  role: string;
  content: string;
  sources?: SharedSource[];
  agentTrace?: { id?: string; phase: string; summary?: string }[];
  contextTraces?: ContextTrace[];
}
export type SharedChatResult =
  | {
      success: true;
      share: { createdAt: string; title: string; workspaceName: string };
      history: SharedMessage[];
    }
  | { success: false; error: string };
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

  get: async (token: string): Promise<SharedChatResult> => {
    try {
      return await api.get<SharedChatResult>(
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
