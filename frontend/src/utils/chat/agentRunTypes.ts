export interface Task {
  budget?: { planOrder?: number };
  id: string;
  status?: string;
  title?: string;
  summary?: string;
  agent?: AgentIdentity;
  progress?: string;
  error?: string;
  attempt?: number;
}
type AgentIdentity = { name?: string };
export interface MessagePart {
  id: string;
  type: string;
  text?: string;
  callIds?: string[];
}
interface Evidence {
  id: string;
  task_id?: string | null;
}
interface ToolExecution {
  call_id: string;
  status: string;
  startedAt?: string;
  completedAt?: string | null;
  task_id?: string;
  tool_id?: string;
  result_summary?: string;
  error?: string | null;
}
export interface Activity {
  id: string | number;
  createdAt?: string;
  phase?: string;
  requestId?: string;
  summary?: string | null;
  summaryKey?: string | null;
  summaryArgs?: Record<string, unknown> | null;
}
export interface ResourceTrace {
  titleArgs?: { name?: string; count?: number };
  detail?: string;
  id: string;
  kind: string;
  titleKey: string;
  createdAt?: string;
}
export interface AgentRunState {
  runId?: string;
  status: string;
  phase: string;
  summary: string;
  summaryKey: string | null;
  summaryArgs: Activity["summaryArgs"];
  agent: AgentIdentity | null;
  runtimeKey: string | null;
  startedAt?: string;
  completedAt?: string | null;
  tasks: Task[];
  evidence: Evidence[];
  toolExecutions: ToolExecution[];
  activities: Activity[];
  resourceTraces: ResourceTrace[];
  messageParts: MessagePart[];
  outputs: unknown[];
}
// Older stored runs can omit fields now emitted by the runtime.
interface TaskFields {
  taskId?: string;
  tasks?: Task[];
  planKind?: string;
  task?: Task | string;
  result?: Partial<Task>;
  attempt?: number;
  childRunId?: string;
  response?: string;
}
interface ToolFields {
  toolId?: string;
  callId?: string;
  groupId?: string;
  code?: string;
  reason?: string;
}
interface ContextFields {
  slug?: string;
  name?: string;
  scope?: string;
  path?: string;
  language?: string;
  count?: number;
  action?: string;
  memories?: { scope: string }[];
  sources?: { title?: string; sourceDocument?: string }[];
  items?: Evidence[];
}
interface MessageFields {
  messageId?: string;
  chatId?: number;
  partId?: string;
  delta?: string;
  partDelta?: string;
  parts?: MessagePart[];
  outputs?: unknown[];
}
export interface RunPayload
  extends TaskFields, ToolFields, ContextFields, MessageFields {
  phase?: string;
  requestId?: string;
  title?: string;
  summary?: string;
  summaryKey?: string;
  summaryArgs?: Activity["summaryArgs"];
  error?: string;
  agent?: AgentIdentity;
  runtime?: { key: string };
  actionRequests?: { name?: string; args?: unknown; description?: string }[];
}
// Only the fields consumed by the chat UI are listed. The wire format may carry
// additional runtime metadata, including on stored events from older releases.
interface EventFields {
  run: Pick<RunPayload, "agent" | "runtime" | "error" | "outputs">;
  activity: Pick<
    RunPayload,
    "phase" | "requestId" | "summary" | "summaryKey" | "summaryArgs"
  >;
  input: {
    requestId?: string;
    questions?: unknown[];
    answers?: unknown[];
    skipped?: boolean;
    allowSkip?: boolean;
    timeoutMs?: number;
  };
  approval: Pick<RunPayload, "requestId" | "actionRequests">;
  plan: Pick<TaskFields, "tasks" | "planKind"> & { reason?: string };
  task: Omit<TaskFields, "task"> & { task?: Task } & Pick<
      RunPayload,
      "agent" | "title" | "summary" | "error"
    >;
  tool: ToolFields & Pick<RunPayload, "taskId" | "summary" | "error">;
  context: ContextFields & Pick<RunPayload, "taskId">;
  skill: ContextFields;
  subagent: Pick<TaskFields, "childRunId" | "response"> & {
    task?: string;
  } & Pick<RunPayload, "agent" | "error">;
  artifacts: Pick<MessageFields, "outputs">;
  message: MessageFields;
}
export type AgentRunEvent = {
  [Family in keyof EventFields]: {
    type: `${Family}.${string}`;
    payload?: EventFields[Family];
    runId?: string;
    id?: number | string;
    createdAt?: string;
  };
}[keyof EventFields];
