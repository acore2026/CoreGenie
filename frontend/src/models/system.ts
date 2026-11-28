import type { StoredUser } from "@/utils/request";
import type { DocumentLibrary } from "@coregenie/contracts";
import { api, cleanHeaders } from "@/utils/api";
import { API_BASE, AUTH_TIMESTAMP, fullApiUrl } from "@/utils/constants";
import { baseHeaders, safeJsonParse } from "@/utils/request";
import DataConnector from "./dataConnector";
import LiveDocumentSync from "./experimental/liveSync";
import AgentPlugins from "./experimental/agentPlugins";
import SystemPromptVariable from "./systemPromptVariable";

export interface GlobalKnowledgeDocument {
  id: number;
  title: string;
  downloadName: string;
  uploadedBy: string | null;
  createdAt: string;
  canDelete: boolean;
}
export interface FooterIcon {
  url: string;
  icon: string;
}
function footerIcons(data: unknown): FooterIcon[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item: unknown): item is FooterIcon =>
      typeof item === "object" &&
      item !== null &&
      "url" in item &&
      typeof item.url === "string" &&
      "icon" in item &&
      typeof item.icon === "string"
  );
}
type AnyRecord = Record<string, unknown>;

export type SlashPresetInput = {
  command: string;
  prompt: string;
  description: string;
};
export type SlashPreset = SlashPresetInput & { id: number };

export interface AvailableModel {
  id: string;
  name: string;
  organization?: string;
  description?: string;
  downloaded?: boolean;
  lang?: string;
  size?: string | number;
  modelCard?: string;
}
export interface SystemKeys extends Record<string, unknown> {
  LLMProvider?: string | null;
  LLMModel?: string | null;
  VectorDB?: string;
  EmbeddingEngine?: string;
  EmbeddingBasePath?: string;
  EmbeddingModelPref?: string;
  GenericOpenAiBasePath?: string;
  GenericOpenAiEmbeddingPassagePrefix?: string;
  GenericOpenAiEmbeddingQueryPrefix?: string;
  GenericOpenAiModelPref?: string;
  OpenAiModelPref?: string;
  PGVectorTableName?: string;
  EmbeddingModelMaxChunkLength?: string | number;
  GenericOpenAiEmbeddingMaxConcurrentChunks?: string | number;
  GenericOpenAiMaxTokens?: string | number;
  GenericOpenAiTokenLimit?: string | number;
  OpenAiKey?: string | boolean;
  GenericOpenAiKey?: string | boolean;
  GenericOpenAiApiKey?: string | boolean;
  GenericOpenAiEmbeddingApiKey?: string | boolean;
  PGVectorConnectionString?: string | boolean;
  credentialsOnly?: boolean;
  MultiUserMode?: boolean;
  RequiresAuth?: boolean;
  DisableViewChatHistory?: boolean;
}

const SYSTEM_KEYS_CACHE_TTL_MS = 1_000;
let systemKeysCache: { value: SystemKeys | null; fetchedAt: number } | null =
  null;
let pendingSystemKeys: Promise<SystemKeys | null> | null = null;
let systemKeysCacheGeneration = 0;

export function clearSystemKeysCache(): void {
  systemKeysCache = null;
  pendingSystemKeys = null;
  systemKeysCacheGeneration += 1;
}

const System = {
  cacheKeys: {
    footerIcons: "anythingllm_footer_links",
    supportEmail: "anythingllm_support_email",
    customAppName: "anythingllm_custom_app_name",
    canViewChatHistory: "anythingllm_can_view_chat_history",
    deploymentVersion: "anythingllm_deployment_version",
  },

  ping: async function (): Promise<boolean> {
    try {
      const res = await api.get<{ online?: boolean }>("/ping", { auth: false });
      return Boolean(res?.online);
    } catch {
      return false;
    }
  },

  totalIndexes: async function (slug: string | null = null): Promise<number> {
    const url = new URL(`${fullApiUrl()}/system/system-vectors`);
    if (slug) url.searchParams.append("slug", encodeURIComponent(slug));
    try {
      const res = await api.get<{ vectorCount?: number }>(url.toString(), {
        defaultError: "Could not find indexes.",
      });
      return res.vectorCount ?? 0;
    } catch {
      return 0;
    }
  },

  isOnboardingComplete: async function (): Promise<boolean> {
    try {
      const res = await api.get<{ onboardingComplete?: boolean }>(
        "/onboarding",
        { auth: false, defaultError: "Could not find onboarding information." }
      );
      return Boolean(res.onboardingComplete);
    } catch {
      return false;
    }
  },

  markOnboardingComplete: async function (): Promise<boolean> {
    try {
      await api.post("/onboarding");
      return true;
    } catch {
      return false;
    }
  },

  keys: async function (): Promise<SystemKeys | null> {
    if (
      systemKeysCache &&
      Date.now() - systemKeysCache.fetchedAt < SYSTEM_KEYS_CACHE_TTL_MS
    ) {
      return systemKeysCache.value;
    }
    if (pendingSystemKeys) return pendingSystemKeys;

    const cacheGeneration = systemKeysCacheGeneration;
    const request = api
      .get<{ results?: SystemKeys }>("/setup-complete", {
        auth: false,
        defaultError: "Could not find setup information.",
      })
      .then((res) => res.results ?? null)
      .then((value) => {
        if (cacheGeneration === systemKeysCacheGeneration) {
          systemKeysCache = { value, fetchedAt: Date.now() };
        }
        return value;
      })
      .catch(() => null)
      .finally(() => {
        if (pendingSystemKeys === request) pendingSystemKeys = null;
      });
    pendingSystemKeys = request;
    return pendingSystemKeys;
  },

  localFiles: async function (): Promise<DocumentLibrary | null> {
    try {
      const res = await api.get<{ localFiles?: DocumentLibrary }>(
        "/system/local-files",
        { defaultError: "Could not find setup information." }
      );
      return res.localFiles ?? null;
    } catch {
      return null;
    }
  },

  needsAuthCheck: function (): boolean {
    const lastAuthCheck = window.localStorage.getItem(AUTH_TIMESTAMP);
    if (!lastAuthCheck) return true;
    const expiresAtMs = Number(lastAuthCheck) + 60 * 5 * 1000;
    return Date.now() > expiresAtMs;
  },

  checkAuth: async function (
    currentToken: string | null = null
  ): Promise<boolean> {
    const valid = await fetch(`${API_BASE}/system/check-token`, {
      headers: cleanHeaders({ ...baseHeaders(currentToken) }),
    })
      .then((res) => res.ok)
      .catch(() => false);

    window.localStorage.setItem(AUTH_TIMESTAMP, String(Date.now()));
    return valid;
  },

  requestToken: async function (body: AnyRecord): Promise<{
    valid: boolean;
    token?: string;
    user?: StoredUser;
    recoveryCodes?: string[];
    message?: string;
  }> {
    try {
      return await api.post<{
        valid: boolean;
        token?: string;
        user?: StoredUser;
        recoveryCodes?: string[];
        message?: string;
      }>(
        "/request-token",
        { ...body },
        {
          auth: false,
          defaultError: "Could not validate login.",
        }
      );
    } catch (e) {
      return { valid: false, message: (e as Error).message };
    }
  },

  refreshUser: (): Promise<{
    success: boolean;
    user: AnyRecord | null;
    message: string | null;
  }> => {
    return api
      .get<{
        success: boolean;
        user: AnyRecord | null;
        message: string | null;
      }>("/system/refresh-user", { defaultError: "Could not refresh user." })
      .catch((e) => ({
        success: false,
        user: null,
        message: (e as Error).message,
      }));
  },

  recoverAccount: async function (
    username: string,
    recoveryCodes: string[]
  ): Promise<{ success: boolean; error?: string; resetToken?: string }> {
    try {
      return await api.post<{
        success: boolean;
        error?: string;
        resetToken?: string;
      }>(
        "/system/recover-account",
        { username, recoveryCodes },
        { defaultError: "Error recovering account." }
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  resetPassword: async function (
    token: string,
    newPassword: string,
    confirmPassword: string
  ): Promise<{ success: boolean; error?: string; [key: string]: unknown }> {
    try {
      return await api.post<{ success: boolean; error?: string }>(
        "/system/reset-password",
        { token, newPassword, confirmPassword },
        { defaultError: "Error resetting password." }
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  checkDocumentProcessorOnline: async (): Promise<boolean> => {
    try {
      await api.get("/system/document-processing-status");
      return true;
    } catch {
      return false;
    }
  },

  acceptedDocumentTypes: async (): Promise<Record<string, string[]> | null> => {
    try {
      const res = await api.get<{ types?: Record<string, string[]> }>(
        "/system/accepted-document-types"
      );
      return res?.types ?? null;
    } catch {
      return null;
    }
  },

  updateSystem: async (
    data: AnyRecord
  ): Promise<{ newValues: AnyRecord | null; error: string | false | null }> => {
    clearSystemKeysCache();
    try {
      return await api.post<{
        newValues: AnyRecord | null;
        error: string | false | null;
      }>("/system/update-env", data);
    } catch (e) {
      console.error(e);
      return { newValues: null, error: (e as Error).message };
    }
  },

  updateSystemPassword: async (
    data: AnyRecord
  ): Promise<{ success: boolean; error?: string | null }> => {
    clearSystemKeysCache();
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        "/system/update-password",
        data
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  setupMultiUser: async (
    data: AnyRecord
  ): Promise<{ success: boolean; error?: string | null }> => {
    clearSystemKeysCache();
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        "/system/enable-multi-user",
        data
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  isMultiUserMode: async (): Promise<boolean> => {
    try {
      const res = await api.get<{ multiUserMode?: boolean }>(
        "/system/multi-user-mode"
      );
      return Boolean(res?.multiUserMode);
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  publicRegistrationStatus: async (): Promise<{ enabled: boolean }> => {
    try {
      const res = await api.get<{ enabled?: boolean }>(
        "/system/public-registration",
        { auth: false }
      );
      return { enabled: Boolean(res?.enabled) };
    } catch (e) {
      console.error(e);
      return { enabled: false };
    }
  },

  updatePublicRegistration: async (
    enabled: boolean
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        "/system/public-registration",
        { enabled }
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  register: async ({
    username,
    password,
    confirmPassword,
  }: {
    username: string;
    password: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; error: string | null }> => {
    try {
      const data = await api.post<{ success?: boolean; error?: string | null }>(
        "/system/register",
        { username, password, confirmPassword },
        { auth: false }
      );
      return {
        success: Boolean(data?.success),
        error: data?.error || null,
      };
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  deleteDocument: async (name: string): Promise<boolean> => {
    try {
      await api.delete("/system/remove-document", { name });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  deleteDocuments: async (names: string[] = []): Promise<boolean> => {
    try {
      await api.delete("/system/remove-documents", { names });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  deleteFolder: async (name: string): Promise<boolean> => {
    try {
      await api.delete("/system/remove-folder", { name });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  uploadPfp: async function (
    formData: FormData
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      await api.post("/system/upload-pfp", formData, {
        defaultError: "Error uploading pfp.",
      });
      return { success: true, error: null };
    } catch (e) {
      console.log(e);
      return { success: false, error: (e as Error).message };
    }
  },

  uploadLogo: async function (
    formData: FormData
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      await api.post("/system/upload-logo", formData, {
        defaultError: "Error uploading logo.",
      });
      return { success: true, error: null };
    } catch (e) {
      console.log(e);
      return { success: false, error: (e as Error).message };
    }
  },

  fetchCustomFooterIcons: async function (): Promise<{
    footerData: FooterIcon[];
    error: string | null;
  }> {
    const cache = window.localStorage.getItem(this.cacheKeys.footerIcons);
    const { data, lastFetched } = cache
      ? safeJsonParse<{ data: unknown[]; lastFetched: number }>(cache, {
          data: [],
          lastFetched: 0,
        })
      : { data: [], lastFetched: 0 };

    if (data && Date.now() - lastFetched < 3_600_000)
      return { footerData: footerIcons(data), error: null };

    try {
      const { footerData, error } = await api.get<{
        footerData?: string | unknown[];
        error?: string | null;
      }>("/system/footer-data", { cache: "no-cache" });
      if (!footerData || error) return { footerData: [], error: null };
      const newData =
        typeof footerData === "string"
          ? safeJsonParse<unknown[]>(footerData, [])
          : footerData;
      window.localStorage.setItem(
        this.cacheKeys.footerIcons,
        JSON.stringify({ data: newData, lastFetched: Date.now() })
      );
      return { footerData: footerIcons(newData), error: null };
    } catch (e) {
      console.log(e);
      return { footerData: [], error: null };
    }
  },

  fetchSupportEmail: async function (): Promise<{
    email: string;
    error: string | null;
  }> {
    const cache = window.localStorage.getItem(this.cacheKeys.supportEmail);
    const { email, lastFetched } = cache
      ? safeJsonParse<{ email: string; lastFetched: number }>(cache, {
          email: "",
          lastFetched: 0,
        })
      : { email: "", lastFetched: 0 };

    if (email && Date.now() - lastFetched < 3_600_000)
      return { email, error: null };

    try {
      const { supportEmail, error } = await api.get<{
        supportEmail?: string;
        error?: string | null;
      }>("/system/support-email", { cache: "no-cache" });
      if (!supportEmail || error) return { email: "", error: null };
      window.localStorage.setItem(
        this.cacheKeys.supportEmail,
        JSON.stringify({ email: supportEmail, lastFetched: Date.now() })
      );
      return { email: supportEmail, error: null };
    } catch (e) {
      console.log(e);
      return { email: "", error: null };
    }
  },

  fetchCustomAppName: async function (): Promise<{
    appName: string;
    error: string | null;
  }> {
    const cache = window.localStorage.getItem(this.cacheKeys.customAppName);
    const { appName, lastFetched } = cache
      ? safeJsonParse<{ appName: string; lastFetched: number }>(cache, {
          appName: "",
          lastFetched: 0,
        })
      : { appName: "", lastFetched: 0 };

    if (appName && Date.now() - lastFetched < 3_600_000)
      return { appName, error: null };

    try {
      const { customAppName, error } = await api.get<{
        customAppName?: string;
        error?: string | null;
      }>("/system/custom-app-name", { cache: "no-cache" });
      if (!customAppName || error) {
        window.localStorage.removeItem(this.cacheKeys.customAppName);
        return { appName: "", error: null };
      }
      window.localStorage.setItem(
        this.cacheKeys.customAppName,
        JSON.stringify({ appName: customAppName, lastFetched: Date.now() })
      );
      return { appName: customAppName, error: null };
    } catch (e) {
      console.log(e);
      return { appName: "", error: null };
    }
  },

  fetchLogo: async function (): Promise<{
    isCustomLogo: boolean;
    logoURL: string | null;
  }> {
    const url = new URL(`${fullApiUrl()}/system/logo`);
    url.searchParams.append("theme", localStorage.getItem("theme") || "system");

    return await fetch(url, {
      method: "GET",
      cache: "no-cache",
    })
      .then(async (res) => {
        if (res.ok && res.status !== 204) {
          const isCustomLogo = res.headers.get("X-Is-Custom-Logo") === "true";
          const blob = await res.blob();
          const logoURL = URL.createObjectURL(blob);
          return { isCustomLogo, logoURL };
        }
        throw new Error("Failed to fetch logo!");
      })
      .catch((e) => {
        console.log(e);
        return { isCustomLogo: false, logoURL: null };
      });
  },

  fetchPfp: async function (id: number | string): Promise<string | null> {
    return await fetch(`${API_BASE}/system/pfp/${id}`, {
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

  removePfp: async function (): Promise<{
    success: boolean;
    error: string | null;
  }> {
    try {
      await api.delete("/system/remove-pfp", undefined, {
        defaultError: "Failed to remove pfp.",
      });
      return { success: true, error: null };
    } catch (e) {
      console.log(e);
      return { success: false, error: (e as Error).message };
    }
  },

  isDefaultLogo: async function (): Promise<boolean | null> {
    try {
      const res = await api.get<{ isDefaultLogo?: boolean }>(
        "/system/is-default-logo",
        {
          auth: false,
          cache: "no-cache",
          defaultError: "Failed to get is default logo!",
        }
      );
      return res?.isDefaultLogo ?? null;
    } catch (e) {
      console.log(e);
      return null;
    }
  },

  removeCustomLogo: async function (): Promise<{
    success: boolean;
    error: string | null;
  }> {
    try {
      await api.get("/system/remove-logo", {
        defaultError: "Error removing logo!",
      });
      return { success: true, error: null };
    } catch (e) {
      console.log(e);
      return { success: false, error: (e as Error).message };
    }
  },

  getApiKeys: async function (): Promise<{
    apiKeys?: AnyRecord[];
    apiKey?: AnyRecord | null;
    error?: string | null;
  }> {
    try {
      return await api.get<{
        apiKeys?: AnyRecord[];
        apiKey?: AnyRecord | null;
        error?: string | null;
      }>("/system/api-keys", { defaultError: "Error fetching api key." });
    } catch (e) {
      console.error(e);
      return { apiKey: null, error: (e as Error).message };
    }
  },

  generateApiKey: async function (
    data: AnyRecord = {}
  ): Promise<{ apiKey: AnyRecord | null; error?: string | null }> {
    try {
      return await api.post<{
        apiKey: AnyRecord | null;
        error?: string | null;
      }>("/system/generate-api-key", data, {
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
      await api.delete(`/system/api-key/${apiKeyId}`);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  customModels: async function (
    provider: string,
    apiKey: string | null = null,
    basePath: string | null = null,
    timeout: number | null = null,
    options: AnyRecord = {}
  ): Promise<{ models: AvailableModel[]; error?: string | null }> {
    const controller = new AbortController();
    const timer = timeout
      ? setTimeout(() => {
          controller.abort("Request timed out.");
        }, timeout)
      : null;

    try {
      return await api.post<{
        models: AvailableModel[];
        error?: string | null;
      }>(
        "/system/custom-models",
        {
          provider,
          apiKey,
          basePath,
          options: options || {},
        },
        {
          signal: controller.signal,
          defaultError: "Error finding custom models.",
        }
      );
    } catch (e) {
      console.error(e);
      return { models: [], error: (e as Error).message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  chats: async (offset = 0): Promise<AnyRecord | unknown[]> => {
    try {
      return await api.post<AnyRecord>("/system/workspace-chats", { offset });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  eventLogs: async (offset = 0): Promise<AnyRecord | unknown[]> => {
    try {
      return await api.post<AnyRecord>("/system/event-logs", { offset });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  clearEventLogs: async (): Promise<{
    success: boolean;
    error?: string | null;
  }> => {
    try {
      return await api.delete<{ success: boolean; error?: string | null }>(
        "/system/event-logs"
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  deleteChat: async (
    chatId: number | string
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.delete<{ success: boolean; error?: string | null }>(
        `/system/workspace-chats/${chatId}`
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  exportChats: async (
    type = "csv",
    chatType = "workspace"
  ): Promise<string | null> => {
    const url = new URL(`${fullApiUrl()}/system/export-chats`);
    url.searchParams.append("type", encodeURIComponent(type));
    url.searchParams.append("chatType", encodeURIComponent(chatType));
    return await fetch(url, {
      method: "GET",
      headers: cleanHeaders({ ...baseHeaders() }),
    })
      .then((res) => {
        if (res.ok) return res.text();
        throw new Error(res.statusText);
      })
      .catch((e) => {
        console.error(e);
        return null;
      });
  },

  updateUser: async (
    data: AnyRecord
  ): Promise<{ success: boolean; error?: string | null }> => {
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        "/system/user",
        data
      );
    } catch (e) {
      console.error(e);
      return { success: false, error: (e as Error).message };
    }
  },

  dataConnectors: DataConnector,

  getSlashCommandPresets: async function (): Promise<SlashPreset[]> {
    try {
      const res = await api.get<{ presets?: SlashPreset[] }>(
        "/system/slash-command-presets",
        { defaultError: "Could not fetch slash command presets." }
      );
      return res.presets || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  createSlashCommandPreset: async function (
    presetData: SlashPresetInput
  ): Promise<{ preset: SlashPreset | null; error: string | null }> {
    try {
      const res = await api.post<{ preset?: SlashPreset | null }>(
        "/system/slash-command-presets",
        presetData,
        { defaultError: "Error creating slash command preset." }
      );
      return { preset: res.preset ?? null, error: null };
    } catch (e) {
      console.error(e);
      return { preset: null, error: (e as Error).message };
    }
  },

  updateSlashCommandPreset: async function (
    presetId: number | string,
    presetData: SlashPresetInput
  ): Promise<{ preset: SlashPreset | null; error: string | null }> {
    try {
      const res = await api.post<{ preset?: SlashPreset | null }>(
        `/system/slash-command-presets/${presetId}`,
        presetData,
        { defaultError: "Could not update slash command preset." }
      );
      return { preset: res.preset ?? null, error: null };
    } catch (e) {
      console.error(e);
      return { preset: null, error: (e as Error).message };
    }
  },

  deleteSlashCommandPreset: async function (
    presetId: number | string
  ): Promise<boolean> {
    try {
      await api.delete(`/system/slash-command-presets/${presetId}`, undefined, {
        defaultError: "Could not delete slash command preset.",
      });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  fetchCanViewChatHistory: async function (): Promise<{
    viewable: boolean;
    error: string | null;
  }> {
    const cache = window.localStorage.getItem(
      this.cacheKeys.canViewChatHistory
    );
    const { viewable, lastFetched } = cache
      ? safeJsonParse<{ viewable: boolean; lastFetched: number }>(cache, {
          viewable: false,
          lastFetched: 0,
        })
      : { viewable: false, lastFetched: 0 };

    if (typeof viewable === "boolean" && Date.now() - lastFetched < 8.64e7)
      return { viewable, error: null };

    const res = await System.keys();
    const isViewable = res?.DisableViewChatHistory === false;

    window.localStorage.setItem(
      this.cacheKeys.canViewChatHistory,
      JSON.stringify({ viewable: isViewable, lastFetched: Date.now() })
    );
    return { viewable: isViewable, error: null };
  },

  simpleSSOLogin: async function (publicToken: string): Promise<{
    valid: boolean;
    user: AnyRecord | null;
    token: string | null;
    message: string | null;
  }> {
    return fetch(`${API_BASE}/request-token/sso/simple?token=${publicToken}`, {
      method: "GET",
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          if (!text.startsWith("{")) throw new Error(text);
          return JSON.parse(text);
        }
        return await res.json();
      })
      .catch((e) => {
        console.error(e);
        return {
          valid: false,
          user: null,
          token: null,
          message: (e as Error).message,
        };
      });
  },

  fetchAppVersion: async function (): Promise<string | null> {
    const cache = window.localStorage.getItem(this.cacheKeys.deploymentVersion);
    const { version, lastFetched } = cache
      ? safeJsonParse<{ version: string | null; lastFetched: number }>(cache, {
          version: null,
          lastFetched: 0,
        })
      : { version: null, lastFetched: 0 };

    if (version && Date.now() - lastFetched < 3_600_000) return version;
    try {
      const res = await api.get<{ appVersion?: string }>("/utils/metrics", {
        auth: false,
        cache: "no-cache",
        defaultError: "Could not fetch app version.",
      });
      const newVersion = res?.appVersion ?? null;
      if (!newVersion) return null;
      window.localStorage.setItem(
        this.cacheKeys.deploymentVersion,
        JSON.stringify({ version: newVersion, lastFetched: Date.now() })
      );
      return newVersion;
    } catch {
      return null;
    }
  },

  validateSQLConnection: async function (
    engine: "postgresql" | "mysql" | "sql-server",
    connectionString: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      return await api.post<{ success: boolean; error: string | null }>(
        "/system/validate-sql-connection",
        { engine, connectionString }
      );
    } catch (e) {
      console.error("Failed to validate SQL connection:", e);
      return { success: false, error: (e as Error).message };
    }
  },

  isFileSystemAgentAvailable: async function (): Promise<boolean> {
    try {
      const res = await api.get<{ available?: boolean }>(
        "/agent-skills/filesystem-agent/is-available"
      );
      return res?.available ?? false;
    } catch {
      return false;
    }
  },

  isCreateFilesAgentAvailable: async function (): Promise<boolean> {
    try {
      const res = await api.get<{ available?: boolean }>(
        "/agent-skills/create-files-agent/is-available"
      );
      return res?.available ?? false;
    } catch {
      return false;
    }
  },

  isSandboxAvailable: async function (): Promise<boolean> {
    try {
      const res = await api.get<{ available?: boolean }>(
        "/agent-skills/sandbox/is-available"
      );
      return res?.available ?? false;
    } catch {
      return false;
    }
  },

  globalKnowledge: async function (): Promise<GlobalKnowledgeDocument[]> {
    const data = await api.get<{ documents?: GlobalKnowledgeDocument[] }>(
      "/system/global-knowledge",
      { defaultError: "无法读取公共知识库。" }
    );
    return data.documents || [];
  },

  uploadGlobalKnowledge: async function (file: File): Promise<AnyRecord> {
    const body = new FormData();
    body.append("file", file, file.name);
    return api.post<AnyRecord>("/system/global-knowledge/upload", body, {
      defaultError: "文档无法加入公共知识库。",
    });
  },

  downloadGlobalKnowledge: async function (id: number | string): Promise<Blob> {
    const response = await fetch(
      `${API_BASE}/system/global-knowledge/${id}/download`,
      { headers: cleanHeaders({ ...baseHeaders() }) }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "文档下载失败，请重试。");
    }
    return response.blob();
  },

  removeGlobalKnowledge: async function (
    id: number | string
  ): Promise<AnyRecord> {
    return api.delete<AnyRecord>(`/system/global-knowledge/${id}`, undefined, {
      defaultError: "无法从公共知识库移除文档。",
    });
  },

  experimentalFeatures: {
    liveSync: LiveDocumentSync,
    agentPlugins: AgentPlugins,
  },

  promptVariables: SystemPromptVariable,
};

export default System;
