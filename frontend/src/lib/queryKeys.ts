export const queryKeys = {
  predefinedAgents: {
    all: ["predefinedAgents"] as const,
  },
  workspaces: {
    all: ["workspaces"] as const,
    sidebar: (id: number | undefined, token: string | null) =>
      ["sidebarPreferences", id ?? null, token] as const,
    memories: (id: number | undefined, token: string | null, slug?: string) =>
      [
        "workspaceMemories",
        id ?? null,
        token,
        ...(slug ? [slug] : []),
      ] as const,
    list: (ownerKey: string) => ["workspaces", "list", ownerKey] as const,
  },
  agentRuns: {
    snapshot: (runId: string) => ["agentRuns", "snapshot", runId] as const,
  },
  system: {
    memorySettings: (id: number | undefined, token: string | null) =>
      ["system", "memorySettings", id ?? null, token] as const,
    logo: ["system", "logo"] as const,
    profilePicture: (id: number | undefined) =>
      ["system", "profilePicture", id] as const,
    simpleSSO: ["system", "simpleSSO"] as const,
    appVersion: ["system", "appVersion"] as const,
    onboardingComplete: ["system", "onboardingComplete"] as const,
    providerModels: (provider: string) =>
      ["system", "providerModels", provider] as const,
  },
} as const;
