import { API_BASE } from "./constants";

/**
 * Check if a href matches the current pathname.
 * Matches exactly or as a parent path (e.g. /settings/model-routers matches /settings/model-routers/1).
 */
export function isPathMatch(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

type PathOptions = {
  search?: Record<string, string> | URLSearchParams | string;
};
function applyOptions(path: string, options: PathOptions = {}) {
  let updatedPath = path;
  if (!options || Object.keys(options).length === 0) return updatedPath;

  if (options.search) {
    const searchParams = new URLSearchParams(options.search);
    updatedPath += `?${searchParams.toString()}`;
  }
  return updatedPath;
}

export default {
  personalSkills: () => "/skills",
  home: () => {
    return "/";
  },
  help: (tab?: string) =>
    tab ? `/help?tab=${encodeURIComponent(tab)}` : "/help",
  protocolFinder: () => "/tools/protocol-finder",
  tools: () => "/tools",
  apiCrGenerator: () => "/tools/api-cr-generator",
  tdocAllocation: () => "/tools/tdoc-allocation",
  proposalFill: () => "/tools/proposal-fill",
  login: (noTry = false) => {
    return `/login${noTry ? "?nt=1" : ""}`;
  },
  register: () => "/register",
  landing: () => "/welcome",
  publicChatShare: (token: string) => `/share/chat/${token}`,
  sso: {
    login: () => {
      return "/sso/simple";
    },
  },
  onboarding: {
    home: () => {
      return "/onboarding";
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
    chat: (slug: string, options: PathOptions = {}) => {
      return applyOptions(`/workspace/${slug}`, options);
    },
    settings: {
      generalAppearance: (slug: string) => {
        return `/workspace/${slug}/settings/general-appearance`;
      },
      chatSettings: function (slug: string, options: PathOptions = {}) {
        return applyOptions(
          `/workspace/${slug}/settings/chat-settings`,
          options
        );
      },
      vectorDatabase: (slug: string) => {
        return `/workspace/${slug}/settings/vector-database`;
      },
      members: (slug: string) => {
        return `/workspace/${slug}/settings/members`;
      },
      agentConfig: (slug: string) => {
        return `/workspace/${slug}/settings/agent-config`;
      },
    },
    thread: (wsSlug: string, threadSlug: string) => {
      return `/workspace/${wsSlug}/t/${threadSlug}`;
    },
    jobs: (slug: string) => `/workspace/${slug}/jobs`,
    jobRuns: (slug: string, jobId: string | number) =>
      `/workspace/${slug}/jobs/${jobId}/runs`,
    jobRunDetail: (
      slug: string,
      jobId: string | number,
      runId: string | number
    ) => `/workspace/${slug}/jobs/${jobId}/runs/${runId}`,
  },
  apiDocs: () => {
    return `${API_BASE}/docs`;
  },
  settings: {
    announcements: () => "/settings/announcements",
    users: () => {
      return `/settings/users`;
    },
    invites: () => {
      return `/settings/invites`;
    },
    workspaces: () => {
      return `/settings/workspaces`;
    },
    globalKnowledge: () => `/settings/global-knowledge`,
    chats: () => {
      return "/settings/workspace-chats";
    },
    llmPreference: () => {
      return "/settings/llm-preference";
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
    quickTasks: () => "/settings/agents/quick-tasks",
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
    experimental: () => {
      return `/settings/beta-features`;
    },
    scheduledJobs: () => {
      return `/settings/scheduled-jobs`;
    },
    scheduledJobRuns: (jobId: string | number) => {
      return `/settings/scheduled-jobs/${jobId}/runs`;
    },
    scheduledJobRunDetail: (jobId: string | number, runId: string | number) => {
      return `/settings/scheduled-jobs/${jobId}/runs/${runId}`;
    },
  },
  // TODO: Migrate all docs.anythingllm.com links to the new docs.
  documentation: {
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
