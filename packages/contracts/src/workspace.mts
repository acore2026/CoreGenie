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
  canModify?: boolean;
  submittedAt?: string | null;
  owner?: { username?: string; displayName?: string };
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
  documents?: { docpath: string }[];
  openAiTemp?: number | null;
  openAiHistory?: number;
  chatMode?: string;
  queryRefusalResponse?: string | null;
  chatProvider?: string | null;
  chatModel?: string | null;
  suggestedMessages?: { heading?: string; message?: string }[];
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

export type FeedbackRating = "good" | "neutral" | "bad";
export interface ChatFeedback {
  rating: FeedbackRating;
  reasonCodes: string[];
  comment?: string | null;
}
export interface FeedbackReason {
  code: string;
  label: string;
  enabled: boolean;
}

export interface LibraryFile {
  type: "file";
  id: string;
  name: string;
  title: string;
  url?: string;
  published?: string;
  pinnedWorkspaces?: number[];
  watched?: boolean;
  canWatch?: boolean;
  cached?: boolean;
}
export interface LibraryFolder {
  type: "folder";
  name: string;
  items: LibraryFile[];
}
export interface DocumentLibrary {
  name?: string;
  type?: "folder";
  items: LibraryFolder[];
}
