export interface WorkspaceMember {
  id: number;
  username: string;
  displayName?: string | null;
  employeeNumber?: string | null;
}
import type { ChatMessage, ChatResult } from "@/utils/chat/messages";
import type {
  WorkspaceRecord,
  ParsedWorkspaceContext,
  ChatFeedback,
  FeedbackReason,
  AttachmentDocument,
} from "@coregenie/contracts";
import { api, cleanHeaders } from "@/utils/api";
import { API_BASE, fullApiUrl } from "@/utils/constants";
import { baseHeaders, safeJsonParse } from "@/utils/request";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import WorkspaceThread, {
  type ChatStreamHandler,
} from "@/models/workspaceThread";
import { v4 } from "uuid";
import { ABORT_STREAM_EVENT } from "@/utils/chat";
import { orderWorkspaces } from "@/utils/workspaceOrder.ts";

export type { WorkspaceRecord };

type AnyRecord = Record<string, unknown>;

async function fetchJsonWithResponse<T = AnyRecord>(
  url: string,
  init: RequestInit
): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T;
  return { response, data };
}

const Workspace = {
  workspaceOrderStorageKey: "anythingllm-workspace-order",
  /** The maximum percentage of the context window that can be used for attachments */
  maxContextWindowLimit: 0.8,

  new: async function (
    data: AnyRecord = {}
  ): Promise<{ workspace: WorkspaceRecord | null; message?: string | null }> {
    try {
      return await api.post<{
        workspace: WorkspaceRecord | null;
        message?: string | null;
      }>("/workspace/new", data);
    } catch (e) {
      return { workspace: null, message: (e as Error).message };
    }
  },

  createInvite: async function (
    slug: string
  ): Promise<{ invite: AnyRecord | null; error?: string | null }> {
    try {
      return await api.post<{
        invite: AnyRecord | null;
        error?: string | null;
      }>(`/workspace/${slug}/invite`, undefined, {
        defaultError: "Unable to create workspace invite.",
      });
    } catch (error) {
      return { invite: null, error: (error as Error).message };
    }
  },

  creationMembers: async function (): Promise<WorkspaceMember[]> {
    const result = await api.get<{ users?: WorkspaceMember[] }>(
      "/workspace/new/members",
      { defaultError: "成员列表加载失败。" }
    );
    return result.users || [];
  },

  update: async function (
    slug: string,
    data: AnyRecord = {}
  ): Promise<{ workspace: WorkspaceRecord | null; message?: string | null }> {
    try {
      return await api.post<{
        workspace: WorkspaceRecord | null;
        message?: string | null;
      }>(`/workspace/${slug}/update`, data);
    } catch (e) {
      return { workspace: null, message: (e as Error).message };
    }
  },

  modifyEmbeddings: async function (
    slug: string,
    changes: AnyRecord = {}
  ): Promise<{ workspace: WorkspaceRecord | null; message?: string | null }> {
    try {
      return await api.post<{
        workspace: WorkspaceRecord | null;
        message?: string | null;
      }>(`/workspace/${slug}/update-embeddings`, changes);
    } catch (e) {
      return { workspace: null, message: (e as Error).message };
    }
  },

  removeQueuedEmbedding: async function (
    slug: string,
    filename: string
  ): Promise<{ success: boolean; [key: string]: unknown }> {
    try {
      return await api.delete<{ success: boolean }>(
        `/workspace/${slug}/embed-queue`,
        { filename }
      );
    } catch {
      return { success: false };
    }
  },

  chatHistory: async function (
    slug: string,
    {
      signal = undefined,
      throwOnError = false,
    }: { signal?: AbortSignal; throwOnError?: boolean } = {}
  ): Promise<ChatMessage[]> {
    try {
      const result = await api.get<{ history?: ChatMessage[] }>(
        `/workspace/${slug}/chats`,
        { signal, defaultError: "Unable to load conversation." }
      );
      return result.history || [];
    } catch (error) {
      if (throwOnError) throw error;
      return [];
    }
  },

  exportChatsToType: async function (
    slug: string,
    threadSlug: string | null = null,
    type = "pdf"
  ): Promise<Blob | null> {
    return await fetch(`${API_BASE}/export-chat/${type}`, {
      method: "POST",
      headers: cleanHeaders({
        ...baseHeaders(),
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ workspaceSlug: slug, threadSlug }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to export chat.");
        return res.blob();
      })
      .catch(() => null);
  },

  updateChatFeedback: async function (
    chatId: number | string,
    slug: string,
    feedback: unknown
  ): Promise<boolean> {
    try {
      await api.post(`/workspace/${slug}/chat-feedback/${chatId}`, {
        feedback,
      });
      return true;
    } catch {
      return false;
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
      }>("/agent-feedback/reasons");
    } catch (error) {
      return { reasons: [], error: (error as Error).message };
    }
  },

  updateAgentFeedback: async function (
    chatId: number | string,
    slug: string,
    feedback: AnyRecord
  ): Promise<{
    success: boolean;
    error?: string | null;
    feedback?: ChatFeedback | null;
  }> {
    try {
      return await api.put<{
        success: boolean;
        feedback?: ChatFeedback | null;
        error?: string | null;
      }>(`/workspace/${slug}/agent-feedback/${chatId}`, feedback);
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  deleteChats: async function (
    slug = "",
    chatIds: (number | string)[] = []
  ): Promise<boolean> {
    try {
      await api.delete(
        `/workspace/${slug}/delete-chats`,
        { chatIds },
        { defaultError: "Failed to delete chats." }
      );
      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  },

  deleteEditedChats: async function (
    slug = "",
    threadSlug = "",
    startingId?: number | string
  ): Promise<boolean> {
    if (threadSlug)
      return this.threads._deleteEditedChats(slug, threadSlug, startingId);
    return this._deleteEditedChats(slug, startingId);
  },

  updateChat: async function (
    slug = "",
    threadSlug = "",
    chatId?: number | string,
    newText = "",
    role = "assistant"
  ): Promise<boolean> {
    if (threadSlug)
      return this.threads._updateChat(slug, threadSlug, chatId, newText, role);
    return this._updateChat(slug, chatId, newText, role);
  },

  multiplexStream: async function ({
    workspaceSlug,
    threadSlug = null,
    prompt,
    chatHandler,
    attachments = [],
    predefinedAgentId = null,
  }: {
    workspaceSlug: string;
    threadSlug?: string | null;
    prompt: string;
    chatHandler: ChatStreamHandler;
    attachments?: unknown[];
    predefinedAgentId?: number | null;
  }): Promise<void> {
    if (threadSlug)
      return this.threads.streamChat(
        { workspaceSlug, threadSlug },
        prompt,
        chatHandler,
        attachments,
        predefinedAgentId
      );
    return this.streamChat(
      { slug: workspaceSlug },
      prompt,
      chatHandler,
      attachments,
      predefinedAgentId
    );
  },

  streamChat: async function (
    { slug }: { slug: string },
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
      await fetchEventSource(`${API_BASE}/workspace/${slug}/stream-chat`, {
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
          const chatResult = safeJsonParse<ChatResult | null>(msg.data, null);
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
      });
    } finally {
      window.removeEventListener(ABORT_STREAM_EVENT, abortStream);
    }
  },

  all: async function ({
    throwOnError = false,
  }: { throwOnError?: boolean } = {}): Promise<WorkspaceRecord[]> {
    try {
      const { workspaces } = await api.get<{ workspaces?: WorkspaceRecord[] }>(
        "/workspaces"
      );
      if (!Array.isArray(workspaces)) throw new Error("Invalid workspace list");
      return workspaces;
    } catch (error) {
      if (throwOnError) throw error;
      return [];
    }
  },

  bySlug: async function (slug = ""): Promise<WorkspaceRecord | null> {
    try {
      const res = await api.get<{ workspace?: WorkspaceRecord | null }>(
        `/workspace/${slug}`
      );
      return res.workspace ?? null;
    } catch {
      return null;
    }
  },

  delete: async function (slug: string): Promise<boolean> {
    try {
      await api.delete(`/workspace/${slug}`);
      return true;
    } catch {
      return false;
    }
  },

  wipeVectorDb: async function (slug: string): Promise<boolean> {
    try {
      await api.delete(`/workspace/${slug}/reset-vector-db`);
      return true;
    } catch {
      return false;
    }
  },

  listFiles: async function (
    slug: string,
    path = "",
    { signal }: { signal?: AbortSignal } = {}
  ): Promise<{
    entries: AnyRecord[];
    path: string;
    aborted?: boolean;
    error?: string;
    [key: string]: unknown;
  }> {
    const query = new URLSearchParams({ path });
    try {
      return await api.get<{ entries: AnyRecord[]; path: string }>(
        `/workspace/${slug}/files?${query}`,
        { signal, defaultError: "Unable to open workspace folder." }
      );
    } catch (error) {
      const err = error as Error;
      return err.name === "AbortError"
        ? { entries: [], path, aborted: true }
        : { entries: [], path, error: err.message };
    }
  },

  previewFile: async function (slug: string, path: string): Promise<AnyRecord> {
    const query = new URLSearchParams({ path });
    try {
      return await api.get<AnyRecord>(
        `/workspace/${slug}/files/preview?${query}`,
        { defaultError: "Unable to preview workspace file." }
      );
    } catch (error) {
      return { error: (error as Error).message };
    }
  },

  downloadFile: async function (slug: string, path: string): Promise<Blob> {
    const query = new URLSearchParams({ path });
    const response = await fetch(
      `${API_BASE}/workspace/${slug}/files/download?${query}`,
      { headers: cleanHeaders({ ...baseHeaders() }) }
    );
    if (!response.ok) throw new Error("Unable to download workspace file.");
    return response.blob();
  },

  downloadFolder: async function (slug: string, path: string): Promise<Blob> {
    const query = new URLSearchParams({ path });
    const response = await fetch(
      `${API_BASE}/workspace/${slug}/files/archive?${query}`,
      { headers: cleanHeaders({ ...baseHeaders() }) }
    );
    if (!response.ok) throw new Error("Unable to download workspace folder.");
    return response.blob();
  },

  uploadWorkspaceFile: async function (slug: string, formData: FormData) {
    return fetchJsonWithResponse<{
      file?: { path: string; size: number };
      error?: string;
    }>(`${API_BASE}/workspace/${slug}/files/upload`, {
      method: "POST",
      body: formData,
      headers: cleanHeaders({ ...baseHeaders() }),
    });
  },

  renameWorkspaceEntry: async function (
    slug: string,
    path: string,
    name: string
  ) {
    return fetchJsonWithResponse(`${API_BASE}/workspace/${slug}/files`, {
      method: "PATCH",
      body: JSON.stringify({ path, name }),
      headers: cleanHeaders({
        ...baseHeaders(),
        "Content-Type": "application/json",
      }),
    });
  },

  deleteWorkspaceEntry: async function (slug: string, path: string) {
    const query = new URLSearchParams({ path });
    return fetchJsonWithResponse(
      `${API_BASE}/workspace/${slug}/files?${query}`,
      { method: "DELETE", headers: cleanHeaders({ ...baseHeaders() }) }
    );
  },

  deleteWorkspaceFile: async function (slug: string, path: string) {
    const query = new URLSearchParams({ path });
    return fetchJsonWithResponse(
      `${API_BASE}/workspace/${slug}/files/upload?${query}`,
      { method: "DELETE", headers: cleanHeaders({ ...baseHeaders() }) }
    );
  },

  uploadFile: async function (slug: string, formData: FormData) {
    return fetchJsonWithResponse(`${API_BASE}/workspace/${slug}/upload`, {
      method: "POST",
      body: formData,
      headers: cleanHeaders({ ...baseHeaders() }),
    });
  },

  parseFile: async function (slug: string, formData: FormData) {
    return fetchJsonWithResponse<{
      files?: { id: number; tokenCountEstimate: number }[];
      error?: string;
    }>(`${API_BASE}/workspace/${slug}/parse`, {
      method: "POST",
      body: formData,
      headers: cleanHeaders({ ...baseHeaders() }),
    });
  },

  getParsedFiles: async function (
    slug: string,
    threadSlug: string | null = null
  ): Promise<ParsedWorkspaceContext> {
    const basePath = new URL(`${fullApiUrl()}/workspace/${slug}/parsed-files`);
    if (threadSlug) basePath.searchParams.set("threadSlug", threadSlug);
    const response = await fetch(basePath, {
      method: "GET",
      headers: cleanHeaders({ ...baseHeaders() }),
    });
    return (await response.json()) as ParsedWorkspaceContext;
  },

  uploadLink: async function (slug: string, link: string) {
    return fetchJsonWithResponse(`${API_BASE}/workspace/${slug}/upload-link`, {
      method: "POST",
      body: JSON.stringify({ link }),
      headers: cleanHeaders({
        ...baseHeaders(),
        "Content-Type": "application/json",
      }),
    });
  },

  getSuggestedMessages: async function (
    slug: string
  ): Promise<unknown[] | null> {
    try {
      const res = await api.get<{ suggestedMessages?: unknown[] }>(
        `/workspace/${slug}/suggested-messages`,
        {
          cache: "no-cache",
          defaultError: "Could not fetch suggested messages.",
        }
      );
      return res.suggestedMessages ?? null;
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  setSuggestedMessages: async function (
    slug: string,
    messages: unknown[]
  ): Promise<{ success: boolean; error?: string; [key: string]: unknown }> {
    try {
      const data = await api.post<AnyRecord>(
        `/workspace/${slug}/suggested-messages`,
        { messages },
        { defaultError: "Error setting suggested messages." }
      );
      return { success: true, ...data };
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  setPinForDocument: async function (
    slug: string,
    docPath: string,
    pinStatus: boolean
  ): Promise<boolean> {
    try {
      await api.post(
        `/workspace/${slug}/update-pin`,
        { docPath, pinStatus },
        { defaultError: "Error setting pin status for document." }
      );
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  uploadPfp: async function (
    formData: FormData,
    slug: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      await api.post(`/workspace/${slug}/upload-pfp`, formData, {
        defaultError: "Error uploading pfp.",
      });
      return { success: true, error: null };
    } catch (e) {
      console.log(e);
      return { success: false, error: (e as Error).message };
    }
  },

  fetchPfp: async function (slug: string): Promise<string | null> {
    return await fetch(`${API_BASE}/workspace/${slug}/pfp`, {
      method: "GET",
      cache: "no-cache",
      headers: cleanHeaders({ ...baseHeaders() }),
    })
      .then((res) => {
        if (res.ok && res.status !== 204) return res.blob();
        throw new Error("Failed to fetch pfp.");
      })
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null);
  },

  removePfp: async function (
    slug: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      await api.delete(`/workspace/${slug}/remove-pfp`, undefined, {
        defaultError: "Failed to remove pfp.",
      });
      return { success: true, error: null };
    } catch (e) {
      console.log(e);
      return { success: false, error: (e as Error).message };
    }
  },

  _updateChat: async function (
    slug = "",
    chatId?: number | string,
    newText = "",
    role = "assistant"
  ): Promise<boolean> {
    try {
      await api.post(
        `/workspace/${slug}/update-chat`,
        { chatId, newText, role },
        { defaultError: "Failed to update chat." }
      );
      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  },

  _deleteEditedChats: async function (
    slug = "",
    startingId?: number | string
  ): Promise<boolean> {
    try {
      await api.delete(
        `/workspace/${slug}/delete-edited-chats`,
        { startingId },
        { defaultError: "Failed to delete chats." }
      );
      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  },

  deleteChat: async (
    chatId: number | string
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.put<{ success: boolean; error?: string | null }>(
        `/workspace/workspace-chats/${chatId}`
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  forkThread: async function (
    slug = "",
    threadSlug: string | null = null,
    chatId: number | string | null = null
  ): Promise<string | null> {
    try {
      const data = await api.post<{ newThreadSlug?: string | null }>(
        `/workspace/${slug}/thread/fork`,
        { threadSlug, chatId },
        { defaultError: "Failed to fork thread." }
      );
      return data.newThreadSlug ?? null;
    } catch (e) {
      console.error("Error forking thread:", e);
      return null;
    }
  },

  uploadAndEmbedFile: async function (slug: string, formData: FormData) {
    return fetchJsonWithResponse(
      `${API_BASE}/workspace/${slug}/upload-and-embed`,
      {
        method: "POST",
        body: formData,
        headers: cleanHeaders({ ...baseHeaders() }),
      }
    );
  },

  deleteParsedFiles: async function (
    slug: string,
    fileIds: (number | string)[] = []
  ): Promise<boolean> {
    try {
      await api.delete(`/workspace/${slug}/delete-parsed-files`, { fileIds });
      return true;
    } catch {
      return false;
    }
  },

  embedParsedFile: async function (slug: string, fileId: number | string) {
    return fetchJsonWithResponse<{
      error?: string | null;
      document?: AttachmentDocument;
    }>(`${API_BASE}/workspace/${slug}/embed-parsed-file/${fileId}`, {
      method: "POST",
      headers: cleanHeaders({ ...baseHeaders() }),
    });
  },

  deleteAndUnembedFile: async function (
    slug: string,
    documentLocation: string
  ): Promise<boolean> {
    try {
      await api.delete(`/workspace/${slug}/remove-and-unembed`, {
        documentLocation,
      });
      return true;
    } catch {
      return false;
    }
  },

  storeWorkspaceOrder: function (
    workspaceIds: (number | string)[] = []
  ): boolean {
    try {
      localStorage.setItem(
        this.workspaceOrderStorageKey,
        JSON.stringify(workspaceIds)
      );
      return true;
    } catch (error) {
      console.error("Error reordering workspaces:", error);
      return false;
    }
  },

  orderWorkspaces,

  searchWorkspaceOrThread: async function (
    searchTerm: string
  ): Promise<{ workspaces: AnyRecord[]; threads: AnyRecord[] }> {
    try {
      return await api.post<{ workspaces: AnyRecord[]; threads: AnyRecord[] }>(
        "/workspace/search",
        { searchTerm }
      );
    } catch (e) {
      console.error(e);
      return { workspaces: [], threads: [] };
    }
  },

  agentCommandAvailable: async function (
    slug: string | null = null
  ): Promise<{ showAgentCommand: boolean }> {
    if (!slug) return { showAgentCommand: true };
    try {
      return await api.get<{ showAgentCommand: boolean }>(
        `/workspace/${slug}/is-agent-command-available`
      );
    } catch (e) {
      console.error(e);
      return { showAgentCommand: true };
    }
  },

  activeAgentInvocation: async function (
    slug: string,
    threadSlug: string | null = null
  ): Promise<{
    invocation: { uuid: string; prompt: string } | null;
    [key: string]: unknown;
  }> {
    const path = threadSlug
      ? `/workspace/${slug}/thread/${threadSlug}/agent-runs/active`
      : `/workspace/${slug}/agent-runs/active`;
    try {
      return await api.get<{
        invocation: { uuid: string; prompt: string } | null;
      }>(path);
    } catch {
      return { invocation: null };
    }
  },

  threads: WorkspaceThread,
};

export default Workspace;
