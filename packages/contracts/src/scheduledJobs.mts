export interface ScheduleConfig {
  type: string;
  frequency: string;
  interval: number;
  weekdays: number[];
  day: number | "last";
  time: string;
  timezone: string;
  date: string;
  anchorAt?: string;
}
export interface JobAgent {
  id: number;
  name: string;
}
export interface JobTool {
  id: string;
  name: string;
  description?: string;
  requiresSetup?: boolean;
}
export interface ToolCategory {
  category: string;
  name: string;
  requiresSetup?: boolean;
  items: JobTool[];
}
export interface JobToolCall {
  toolName: string;
  timestamp?: string;
  arguments?: unknown;
  result?: unknown;
  status?: string;
  error?: string;
}
export interface GeneratedFile {
  filename: string;
  storageFilename?: string;
  fileSize: number;
}
export interface JobMetrics {
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
}
export interface JobResult {
  duration?: number;
  thoughts?: string[];
  toolCalls?: JobToolCall[];
  outputs?: { type: string; payload: GeneratedFile }[];
  text?: string;
  metrics?: JobMetrics;
}
export interface RunRecord {
  id: number;
  status: string;
  readAt?: string | null;
  completedAt?: string | null;
  startedAt: string;
  error?: string | null;
  result?: JobResult | null;
}
export interface JobRecord {
  id: number;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  agent_id?: number | null;
  agent?: JobAgent | null;
  creator?: { username: string } | null;
  tools?: string[] | string | null;
  scheduleConfig?: Partial<ScheduleConfig> | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  latestRun?: RunRecord | null;
}
