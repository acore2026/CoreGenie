import type { AgentRunEvent, AgentRunState, RunPayload } from "./agentRunTypes";

export interface ChatCommand {
  text?: string;
  autoSubmit?: boolean;
  writeMode?: string;
  history?: ChatMessage[];
  attachments?: unknown[];
}

export interface ContextTrace {
  id: string;
  title?: string;
}
export interface ChatMessage {
  uuid?: string;
  type?: string;
  role?: string;
  content?: unknown;
  animate?: boolean;
  chatId?: number | null;
  outputs?: unknown[];
  messageParts?: unknown[];
  runtime?: { key: string } | null;
  subagentRun?: { status?: string };
  userMessage?: string;
  attachments?: unknown[];
  sources?: unknown[];
  pending?: boolean;
  agentRunState?: Partial<AgentRunState>;
  agentRunId?: string | null;
  contextTrace?: ContextTrace;
  contextTraces?: ContextTrace[];
  requestId?: string;
  [key: string]: unknown;
}

export interface ChatResult {
  id?: string;
  uuid?: string;
  textResponse?: string | null;
  type: string;
  sources?: unknown[];
  error?: unknown;
  close?: boolean;
  animate?: boolean;
  chatId?: number | null;
  action?: string | null;
  metrics?: unknown;
  routedTo?: unknown;
  websocketUUID?: string;
  thread?: { slug?: string; name?: string };
}

export type LifecycleEvent = AgentRunEvent & {
  payload?: RunPayload & {
    questions?: unknown[];
    allowSkip?: boolean;
    skipped?: boolean;
    answers?: unknown[];
    timeoutMs?: number;
  };
};

interface StreamContent {
  type: string;
  uuid?: string;
  content?: unknown;
  agentRunId?: string;
  agentRunEvent?: LifecycleEvent;
  routedTo?: unknown;
  run?: {
    task?: string;
    agent?: { name?: string };
    status?: string;
    error?: string;
  };
  trace?: ContextTrace;
  citations?: unknown[];
  metrics?: unknown;
  chatId?: number;
  outputs?: unknown[];
  parts?: unknown[];
}
type Frame<Type extends string, Content> = {
  type: Type;
  content: Content;
  animate?: boolean;
  metrics?: unknown;
};
export type SocketFrame =
  | Frame<"agentRunEvent", { runId?: string; event?: LifecycleEvent }>
  | Frame<
      "agentStatus",
      { uuid?: string; active?: boolean; phase?: string; summary?: string }
    >
  | Frame<"rename_thread", { slug?: string; name?: string }>
  | Frame<"reportStreamEvent", StreamContent>
  | (Frame<"clarificationRequest", unknown> & {
      requestId?: string;
      questions?: unknown[];
      allowSkip?: boolean;
      timeoutMs?: number;
    })
  | (Omit<Frame<"toolApprovalRequest", unknown>, "content"> & {
      content?: unknown;
    } & {
      requestId?: string;
      skillName?: string;
      allowRemember?: boolean;
      payload?: unknown;
      description?: string;
      timeoutMs?: number;
    })
  | Frame<
      | "textResponse"
      | "statusResponse"
      | "fileDownloadCard"
      | "scheduledJobCreated"
      | "awaitingFeedback"
      | "wssFailure"
      | "rechartVisualize",
      unknown
    >
  | {
      type?: undefined;
      content?: unknown;
      animate?: boolean;
      metrics?: unknown;
    };
