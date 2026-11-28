import type { WorkspaceThreadRecord } from "@coregenie/contracts";
import { api, cleanHeaders } from "@/utils/api";
import { ABORT_STREAM_EVENT } from "@/utils/chat";
import { API_BASE } from "@/utils/constants";
import { baseHeaders, safeJsonParse } from "@/utils/request";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { v4 } from "uuid";

export type { WorkspaceThreadRecord };

export type ChatStreamHandler = (event: Record<string, unknown>) => void;

const WorkspaceThread = {
  all: async function (
    workspaceSlug: string,
    { throwOnError = false }: { throwOnError?: boolean } = {}
  ): Promise<{
    threads: WorkspaceThreadRecord[];
    defaultThreadChatCount: number;
  }> {
    try {
      const res = await api.get<{
        threads?: WorkspaceThreadRecord[];
        defaultThreadChatCount?: number;
      }>(`/workspace/${workspaceSlug}/threads`, {
        defaultError: "Unable to load threads",
      });
      return {
        threads: res.threads || [],
        defaultThreadChatCount: res.defaultThreadChatCount ?? 0,
      };
    } catch (error) {
      if (throwOnError) throw error;
      return { threads: [], defaultThreadChatCount: 0 };
    }
  },

  new: async function (
    workspaceSlug: string
  ): Promise<{ thread: WorkspaceThreadRecord | null; error?: string | null }> {
    try {
      return await api.post<{
        thread: WorkspaceThreadRecord | null;
        error?: string | null;
      }>(`/workspace/${workspaceSlug}/thread/new`);
    } catch (e) {
      return { thread: null, error: (e as Error).message };
    }
  },

  update: async function (
    workspaceSlug: string,
    threadSlug: string,
    data: Record<string, unknown> = {}
  ): Promise<{
    thread: WorkspaceThreadRecord | null;
    message?: string | null;
  }> {
    try {
      return await api.post<{
        thread: WorkspaceThreadRecord | null;
        message?: string | null;
      }>(`/workspace/${workspaceSlug}/thread/${threadSlug}/update`, data);
    } catch (e) {
      return { thread: null, message: (e as Error).message };
    }
  },

  delete: async function (
    workspaceSlug: string,
    threadSlug: string
  ): Promise<boolean> {
    try {
      await api.delete(`/workspace/${workspaceSlug}/thread/${threadSlug}`);
      return true;
    } catch {
      return false;
    }
  },

  deleteBulk: async function (
    workspaceSlug: string,
    threadSlugs: string[] = []
  ): Promise<boolean> {
    try {
      await api.delete(`/workspace/${workspaceSlug}/thread-bulk-delete`, {
        slugs: threadSlugs,
      });
      return true;
    } catch {
      return false;
    }
  },

  chatHistory: async function (
    workspaceSlug: string,
    threadSlug: string,
    {
      signal = undefined,
      throwOnError = false,
    }: { signal?: AbortSignal; throwOnError?: boolean } = {}
  ): Promise<{
    history: Record<string, unknown>[];
    thread: WorkspaceThreadRecord | null;
  }> {
    try {
      const result = await api.get<{
        history?: Record<string, unknown>[];
        thread?: WorkspaceThreadRecord | null;
      }>(`/workspace/${workspaceSlug}/thread/${threadSlug}/chats`, {
        signal,
        defaultError: "Unable to load conversation.",
      });
      return {
        history: result.history || [],
        thread: result.thread || null,
      };
    } catch (error) {
      if (throwOnError) throw error;
      return { history: [], thread: null };
    }
  },

  streamChat: async function (
    {
      workspaceSlug,
      threadSlug,
    }: { workspaceSlug: string; threadSlug: string },
    message: string,
    handleChat: ChatStreamHandler,
    attachments: unknown[] = [],
    predefinedAgentId: number | null = null
  ): Promise<void> {
    const ctrl = new AbortController();

    const abortStream = () => {
      ctrl.abort();
      handleChat({ id: v4(), type: "stopGeneration" });
    };
    window.addEventListener(ABORT_STREAM_EVENT, abortStream);

    try {
      await fetchEventSource(
        `${API_BASE}/workspace/${workspaceSlug}/thread/${threadSlug}/stream-chat`,
        {
          method: "POST",
          body: JSON.stringify({ message, attachments, predefinedAgentId }),
          headers: cleanHeaders({
            ...baseHeaders(),
            "Content-Type": "application/json",
          }),
          signal: ctrl.signal,
          openWhenHidden: true,
          async onopen(response) {
            if (response.ok) return;
            if (
              response.status >= 400 &&
              response.status < 500 &&
              response.status !== 429
            ) {
              handleChat({
                id: v4(),
                type: "abort",
                textResponse: null,
                sources: [],
                close: true,
                error: `An error occurred while streaming response. Code ${response.status}`,
              });
              ctrl.abort();
              throw new Error("Invalid Status code response.");
            }
            handleChat({
              id: v4(),
              type: "abort",
              textResponse: null,
              sources: [],
              close: true,
              error: `An error occurred while streaming response. Unknown Error.`,
            });
            ctrl.abort();
            throw new Error("Unknown error");
          },
          async onmessage(msg) {
            const chatResult = safeJsonParse<Record<string, unknown> | null>(
              msg.data,
              null
            );
            if (chatResult) handleChat(chatResult);
          },
          onerror(err) {
            handleChat({
              id: v4(),
              type: "abort",
              textResponse: null,
              sources: [],
              close: true,
              error: `An error occurred while streaming response. ${(err as Error).message}`,
            });
            ctrl.abort();
            throw new Error();
          },
        }
      );
    } finally {
      window.removeEventListener(ABORT_STREAM_EVENT, abortStream);
    }
  },

  _deleteEditedChats: async function (
    workspaceSlug = "",
    threadSlug = "",
    startingId?: number | string
  ): Promise<boolean> {
    try {
      await api.delete(
        `/workspace/${workspaceSlug}/thread/${threadSlug}/delete-edited-chats`,
        { startingId },
        { defaultError: "Failed to delete chats." }
      );
      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  },

  _updateChat: async function (
    workspaceSlug = "",
    threadSlug = "",
    chatId?: number | string,
    newText = "",
    role = "assistant"
  ): Promise<boolean> {
    try {
      await api.post(
        `/workspace/${workspaceSlug}/thread/${threadSlug}/update-chat`,
        { chatId, newText, role },
        { defaultError: "Failed to update chat." }
      );
      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  },
};

export default WorkspaceThread;
