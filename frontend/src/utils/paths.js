import { API_BASE } from "./constants";

/**
 * Check if a href matches the current pathname.
 * Matches exactly or as a parent path (e.g. /settings/model-routers matches /settings/model-routers/1).
 */
export function isPathMatch(href, pathname) {
  return pathname === href || pathname.startsWith(href + "/");
}

function applyOptions(path, options = {}) {
  let updatedPath = path;
  if (!options || Object.keys(options).length === 0) return updatedPath;

  if (options.search) {
    const searchParams = new URLSearchParams(options.search);
    updatedPath += `?${searchParams.toString()}`;
  }
  return updatedPath;
}

export default {
  home: () => {
    return "/";
  },
  help: () => "/help",
  login: (noTry = false) => {
    return `/login${noTry ? "?nt=1" : ""}`;
  },
  register: () => "/register",
  publicChatShare: (token) => `/share/chat/${token}`,
  sso: {
    login: () => {
      return "/sso/simple";
    },
  },
  onboarding: {
    home: () => {
      return "/onboarding";
    },
    survey: () => {
      return "/onboarding/survey";
    },
    llmPreference: () => {
      return "/onboarding/llm-preference";
    },
    embeddingPreference: () => {
      return "/onboarding/embedding-preference";
    },
    vectorDatabase: () => {
      return "/onboarding/vector-database";
    },
    userSetup: () => {
      return "/onboarding/user-setup";
    },
    dataHandling: () => {
      return "/onboarding/data-handling";
    },
  },
  github: () => {
    return "https://github.com/Mintplex-Labs/anything-llm";
  },
  discord: () => {
    return "https://discord.com/invite/6UyHPeGZAC";
  },
  docs: (path = "") => {
    return `https://docs.anythingllm.com${path}`;
  },
  chatModes: () => {
    return "https://docs.anythingllm.com/features/chat-modes";
  },
  mailToMintplex: () => {
    return "mailto:team@mintplexlabs.com";
  },
  hosting: () => {
    return "https://my.mintplexlabs.com/aio-checkout?product=anythingllm";
  },
  workspace: {
    chat: (slug, options = {}) => {
      return applyOptions(`/workspace/${slug}`, options);
    },
    settings: {
      generalAppearance: (slug) => {
        return `/workspace/${slug}/settings/general-appearance`;
      },
      chatSettings: function (slug, options = {}) {
        return applyOptions(
          `/workspace/${slug}/settings/chat-settings`,
          options
        );
      },
      vectorDatabase: (slug) => {
        return `/workspace/${slug}/settings/vector-database`;
      },
      members: (slug) => {
        return `/workspace/${slug}/settings/members`;
      },
      agentConfig: (slug) => {
        return `/workspace/${slug}/settings/agent-config`;
      },
    },
    thread: (wsSlug, threadSlug) => {
      return `/workspace/${wsSlug}/t/${threadSlug}`;
    },
    jobs: (slug) => `/workspace/${slug}/jobs`,
    jobRuns: (slug, jobId) => `/workspace/${slug}/jobs/${jobId}/runs`,
    jobRunDetail: (slug, jobId, runId) =>
      `/workspace/${slug}/jobs/${jobId}/runs/${runId}`,
  },
  apiDocs: () => {
    return `${API_BASE}/docs`;
  },
  settings: {
    users: () => {
      return `/settings/users`;
    },
    invites: () => {
      return `/settings/invites`;
    },
    workspaces: () => {
      return `/settings/workspaces`;
    },
    chats: () => {
      return "/settings/workspace-chats";
    },
    llmPreference: () => {
      return "/settings/llm-preference";
    },
    transcriptionPreference: () => {
      return "/settings/transcription-preference";
    },
    audioPreference: () => {
      return "/settings/audio-preference";
    },
    embedder: {
      modelPreference: () => "/settings/embedding-preference",
      chunkingPreference: () => "/settings/text-splitter-preference",
    },
    embeddingPreference: () => {
      return "/settings/embedding-preference";
    },
    vectorDatabase: () => {
      return "/settings/vector-database";
    },
    security: () => {
      return "/settings/security";
    },
    interface: () => {
      return "/settings/interface";
    },
    branding: () => {
      return "/settings/branding";
    },
    agentSkills: () => {
      return "/settings/agents/tools";
    },
    agents: () => {
      return "/settings/agents";
    },
    predefinedAgentSkills: () => {
      return "/settings/agents/skills";
    },
    agentTools: () => {
      return "/settings/agents/tools";
    },
    agentPrompts: () => {
      return "/settings/agents/prompts";
    },
    agentFeedback: () => {
      return "/settings/agents/feedback";
    },
    chat: () => {
      return "/settings/chat";
    },
    apiKeys: () => {
      return "/settings/api-keys";
    },
    systemPromptVariables: () => "/settings/system-prompt-variables",
    logs: () => {
      return "/settings/event-logs";
    },
    privacy: () => {
      return "/settings/privacy";
    },
    embedChatWidgets: () => {
      return `/settings/embed-chat-widgets`;
    },
    browserExtension: () => {
      return `/settings/browser-extension`;
    },
    mobile: () => {
      return `/settings/mobile-connections`;
    },
    experimental: () => {
      return `/settings/beta-features`;
    },
    mobileConnections: () => {
      return `/settings/mobile-connections`;
    },
    telegram: () => {
      return `/settings/external-connections/telegram`;
    },
    scheduledJobs: () => {
      return `/settings/scheduled-jobs`;
    },
    scheduledJobRuns: (jobId) => {
      return `/settings/scheduled-jobs/${jobId}/runs`;
    },
    scheduledJobRunDetail: (jobId, runId) => {
      return `/settings/scheduled-jobs/${jobId}/runs/${runId}`;
    },
  },
  // TODO: Migrate all docs.anythingllm.com links to the new docs.
  documentation: {
    mobileIntroduction: () => {
      return "https://docs.anythingllm.com/mobile/overview";
    },
    contextWindows: () => {
      return "https://docs.anythingllm.com/chatting-with-documents/introduction#you-exceed-the-context-window---what-now";
    },
  },

  experimental: {
    liveDocumentSync: {
      manage: () => `/settings/beta-features/live-document-sync/manage`,
    },
  },
};
