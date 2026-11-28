export interface PromptHistoryEntry {
  id: number;
  workspaceId: number;
  prompt: string;
  modifiedBy: number | null;
  modifiedAt: string;
  user?: { id: number; username: string; role?: string } | null;
}

export interface SystemPromptVariableRecord {
  id?: number | null;
  key: string;
  value: string;
  description?: string;
  type?: string;
}

export interface WorkspaceThreadRecord {
  id: number;
  name: string;
  slug: string;
  workspace_id?: number;
  user_id?: number | null;
  createdAt?: string;
  lastUpdatedAt?: string;
}

export interface WorkspaceRecord {
  id: number;
  name: string;
  slug: string;
  createdAt?: string;
  lastUpdatedAt?: string;
  openAiTemp?: number | null;
  openAiHistory?: number;
  chatMode?: string;
  chatProvider?: string | null;
  chatModel?: string | null;
  [key: string]: unknown;
}

export interface ParsedWorkspaceFile {
  id: number;
  title: string;
  location?: string;
  token_count_estimate: number;
}

export interface ParsedWorkspaceContext {
  files: ParsedWorkspaceFile[];
  contextWindow: number;
  currentContextTokenCount: number;
}

export interface AttachmentDocument {
  id?: string | number;
  location?: string;
  size?: number;
}
