export const queryKeys = {
  predefinedAgents: {
    all: ["predefinedAgents"] as const,
  },
  workspaces: {
    all: ["workspaces"] as const,
    list: (ownerKey: string) => ["workspaces", "list", ownerKey] as const,
  },
  agentRuns: {
    snapshot: (runId: string) => ["agentRuns", "snapshot", runId] as const,
  },
  system: {
    appVersion: ["system", "appVersion"] as const,
    onboardingComplete: ["system", "onboardingComplete"] as const,
    providerModels: (provider: string) =>
      ["system", "providerModels", provider] as const,
  },
} as const;
