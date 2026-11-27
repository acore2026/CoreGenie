export interface ExamplePrompt {
  label: string;
  prompt: string;
}
export interface Agent {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  showInRoster?: boolean;
  isBuiltinDefault?: boolean;
  iconUrl?: string;
  welcomeMessage?: string;
  examplePrompts?: (string | ExamplePrompt)[];
  systemPrompt?: string;
  tools: string[] | null;
  skillIds: number[];
  quickTaskIds?: number[];
  runtimeKey: string;
  runtimeConfig?: Record<string, unknown>;
}
export interface SkillFile {
  path: string;
  text: boolean;
  content?: string;
  encoding?: "utf8" | "base64";
  size?: number;
}
export interface Skill {
  isShared?: boolean;
  isOwner?: boolean;
  enabled?: boolean;
  revision?: string;
  owner?: { id: number; username: string };
  id: number | null;
  name: string;
  description: string;
  valid?: boolean;
  instructions?: string;
  warnings?: string[];
  errors?: string[];
  skillMd?: string;
  files?: SkillFile[];
}
export interface QuickTask {
  id: number;
  title: string;
  description: string;
  key: string;
  archived?: boolean;
}
export interface Runtime {
  key: string;
  label: string;
  description: string;
  experimental?: boolean;
  modelRoles: string[];
}
export interface Tool {
  id: string;
  name: string;
  description?: string;
}
export interface Capability {
  provider: string;
  model: string;
  source?: string;
  vision: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  reasoningControls: boolean;
}
export interface AdminData {
  agents: Agent[];
  skills: (Skill & { id: number })[];
  quickTasks: QuickTask[];
  tools: Tool[];
  runtimes: Runtime[];
  modelCapabilities: Capability[];
  defaultAgentId: number | null;
}
export type SaveResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error?: string };
