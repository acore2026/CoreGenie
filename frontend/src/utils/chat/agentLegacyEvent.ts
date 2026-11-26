import type { RunPayload } from "./agentRunTypes.ts";

export function legacyEventFromAgentRun(
  event: {
    runId?: string;
    type?: string;
    payload?: RunPayload;
    id?: number | string;
    createdAt?: string;
  } | null
) {
  if (!event?.runId || !event?.type || !event?.payload) return event;
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
        event: {
          id: event.id,
          runId,
          type,
          payload,
          createdAt: event.createdAt,
        },
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
        agentRunEvent: {
          id: event.id,
          runId,
          type,
          payload,
          createdAt: event.createdAt,
        },
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
        agentRunEvent: {
          id: event.id,
          runId,
          type,
          payload,
          createdAt: event.createdAt,
        },
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
