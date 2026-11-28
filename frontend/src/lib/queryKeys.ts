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
} as const;
