import type { RunPayload } from "./agentRunTypes";
import type { SocketFrame, LifecycleEvent } from "./messages";

export interface RunEnvelope {
  runId: string;
  type: string;
  payload: RunPayload;
  id?: number | string;
  createdAt?: string;
}

export function legacyEventFromAgentRun(
  event: RunEnvelope | SocketFrame | null
): SocketFrame | null {
  if (!event) return null;
  if (!("runId" in event) || !event.runId || !event.payload)
    return event as SocketFrame;
  const { runId, type, payload } = event;
  if (
    type === "activity.updated" ||
    type.startsWith("input.") ||
    type.startsWith("plan.") ||
    type.startsWith("task.") ||
    type.startsWith("tool.") ||
    type.startsWith("context.") ||
    type.startsWith("skill.") ||
    type.startsWith("subagent.") ||
    type === "artifacts.updated" ||
    type.startsWith("run.")
  )
    return {
      type: "agentRunEvent",
      content: {
        runId,
        event: event as LifecycleEvent,
      },
    };
  if (type === "message.delta")
    return {
      type: "reportStreamEvent",
      content: {
        type: "textResponseChunk",
        uuid: payload.messageId,
        content: payload.delta,
        agentRunId: runId,
        agentRunEvent: event as LifecycleEvent,
      },
    };
  if (type === "message.completed")
    return {
      type: "reportStreamEvent",
      content: {
        type: "chatId",
        uuid: payload.messageId,
        chatId: payload.chatId,
        agentRunId: runId,
        parts: payload.parts,
        outputs: payload.outputs,
        agentRunEvent: event as LifecycleEvent,
      },
    };
  if (type === "approval.requested") {
    const actions = payload.actionRequests || [];
    const first = actions[0] || {};
    return {
      type: "toolApprovalRequest",
      requestId: payload.requestId,
      skillName:
        actions.length > 1 ? `${actions.length} tool actions` : first.name,
      payload: actions.length > 1 ? { actions } : first.args,
      description: first.description || "Review the requested tool execution",
      allowRemember: actions.length === 1,
    };
  }
  if (type === "thread.renamed")
    return { type: "rename_thread", content: payload };
  return null;
}
