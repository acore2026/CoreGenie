const { z } = require("zod");
const { Annotation } = require("@langchain/langgraph");
const { agentMaxConcurrency } = require("../../concurrency");
const { mergeActivatedSkills } = require("../../activatedSkills");
const { evidenceSchema } = require("../evidenceResearch");

export interface GovernedDefaults {
  readonly maxTasks: number;
  readonly maxConcurrency: number;
  readonly maxReviewRounds: number;
  readonly maxTaskToolCalls: number;
  readonly maxTaskModelCalls: number;
  readonly maxTaskMs: number;
  readonly maxRunMs: number;
  readonly maxConsecutiveNoProgress: number;
  readonly maxQuickLookupToolCalls: number;
  readonly maxQuickLookupModelCalls: number;
}

const DEFAULTS: GovernedDefaults = Object.freeze({
  maxTasks: 24,
  maxConcurrency: agentMaxConcurrency(),
  maxReviewRounds: 1,
  maxTaskToolCalls: 200,
  maxTaskModelCalls: 80,
  maxTaskMs: 60 * 60 * 1_000,
  maxRunMs: 4 * 60 * 60 * 1_000,
  maxConsecutiveNoProgress: 8,
  maxQuickLookupToolCalls: 32,
  maxQuickLookupModelCalls: 24,
});

const taskSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(180),
  objective: z.string().trim().min(1).max(2_000),
  dependsOn: z.array(z.string().trim().min(1)).max(12).default([]),
  assignedAgentId: z.number().int().positive().nullable().optional(),
  allowedToolIds: z.array(z.string().trim().min(1)).max(40).default([]),
  requiredCapabilities: z.array(z.string().trim().min(1)).max(20).default([]),
  successCriteria: z.array(z.string().trim().min(1)).max(12).default([]),
  acceptsPartialDependencies: z.boolean().default(false),
  writeIntent: z.boolean().default(false),
});

const planSchema = z.object({
  goal: z.string().trim().min(1).max(1_000),
  tasks: z.array(taskSchema).min(1).max(DEFAULTS.maxTasks),
});

const workerResultSchema = z.object({
  summary: z.string().trim().min(1).max(12_000),
  evidence: z.array(evidenceSchema).max(50).default([]),
  unresolved: z.array(z.string().trim().min(1)).max(30).default([]),
});

const reviewSchema = z.object({
  status: z.enum(["accept", "partial", "revise"]),
  gaps: z.array(z.string().trim().min(1)).max(20).default([]),
  replacementTasks: z.array(taskSchema).max(6).default([]),
});

export interface GovernedTask {
  id: string;
  title: string;
  objective: string;
  dependsOn: string[];
  assignedAgentId?: number | null;
  allowedToolIds: string[];
  requiredCapabilities: string[];
  successCriteria: string[];
  acceptsPartialDependencies: boolean;
  writeIntent: boolean;
  budget?: {
    maxToolCalls: number;
    maxModelCalls: number;
    maxElapsedMs: number;
  };
}

export interface GovernedPlan {
  goal: string;
  tasks: GovernedTask[];
}

export interface EvidenceRecord {
  id?: string;
  kind: string;
  title: string;
  uri: string | null;
  excerpt: string;
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  id: string;
  status: string;
  summary: string;
  error?: string | null;
  unresolved: string[];
  evidence: EvidenceRecord[];
  durationMs?: number;
  agent?: { id: number; name: string };
}

export interface ToolExecutionRecord {
  id?: string;
  tool_id?: string;
  toolId?: string;
  status?: string;
  operation_key?: string;
  operationKey?: string;
  arguments?: Record<string, unknown>;
  result?: {
    ok?: boolean;
    code?: string;
    summary?: string;
    data?: unknown;
  };
  result_summary?: string;
}

export interface ReviewDecision {
  status: "accept" | "partial" | "revise";
  gaps?: string[];
  replacementTasks?: GovernedTask[];
}

export interface ContextItem {
  id: string;
  kind: string;
  title: string;
  text?: string;
  excerpt?: string;
  source?: Record<string, unknown> | null;
}

export interface ActivatedSkillRecord {
  name: string;
  revision?: string | null;
  [key: string]: unknown;
}

export interface GovernedStateValue {
  request: string;
  history: unknown[];
  attachments: unknown[];
  controllerAttachments: unknown[];
  clarification: string;
  contextItems: ContextItem[];
  activatedSkills: ActivatedSkillRecord[];
  planningFeedback: string;
  planningAttempts: number;
  control: Record<string, unknown> | null;
  plan: GovernedPlan | null;
  workItem: GovernedTask | null;
  taskResults: TaskResult[];
  evidence: EvidenceRecord[];
  review: ReviewDecision | null;
  reviewRound: number;
  finalResponse: string;
  sources: unknown[];
}

export interface GovernedContext {
  run: Record<string, any>;
  workspace: Record<string, any>;
  user: Record<string, any> | null;
  thread?: Record<string, any> | null;
  agent: Record<string, any>;
  history?: unknown[];
  emit: (event: string, payload?: Record<string, unknown>) => Promise<void>;
  signal?: AbortSignal;
  runnableConfig?: Record<string, unknown>;
  onToken: (token: string) => Promise<void> | void;
  budget?: Record<string, any>;
  activatedSkillScope?: Map<string, any>;
  inheritedSkills?: ActivatedSkillRecord[];
  depth?: number;
}

function mergeById<T extends { id?: string }>(
  current: T[] = [],
  updates: T[] = []
): T[] {
  const merged = new Map<string | undefined, T>(
    current.map((item) => [item.id, item])
  );
  for (const item of updates || []) merged.set(item.id, item);
  return [...merged.values()];
}

const GovernedState = Annotation.Root({
  request: Annotation({ default: () => "" }),
  history: Annotation({ default: () => [] }),
  attachments: Annotation({ default: () => [] }),
  controllerAttachments: Annotation({ default: () => [] }),
  clarification: Annotation({ default: () => "" }),
  contextItems: Annotation({ reducer: mergeById, default: () => [] }),
  activatedSkills: Annotation({
    reducer: mergeActivatedSkills,
    default: () => [],
  }),
  planningFeedback: Annotation({ default: () => "" }),
  planningAttempts: Annotation({ default: () => 0 }),
  control: Annotation({ default: () => null }),
  plan: Annotation({ default: () => null }),
  workItem: Annotation({ default: () => null }),
  taskResults: Annotation({ reducer: mergeById, default: () => [] }),
  evidence: Annotation({ reducer: mergeById, default: () => [] }),
  review: Annotation({ default: () => null }),
  reviewRound: Annotation({ default: () => 0 }),
  finalResponse: Annotation({ default: () => "" }),
  sources: Annotation({ default: () => [] }),
});

module.exports = {
  DEFAULTS,
  GovernedState,
  mergeById,
  planSchema,
  reviewSchema,
  taskSchema,
  workerResultSchema,
};
