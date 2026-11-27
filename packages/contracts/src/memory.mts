export type MemoryScope = "workspace" | "global";

export interface Memory {
  id: number;
  userId: number | null;
  workspaceId: number | null;
  scope: MemoryScope;
  content: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemories {
  global: Memory[];
  workspace: Memory[];
}
