import { v4 } from "uuid";
import type { ChatMessage } from "./messages";
import type { AgentRunEvent } from "./agentRunTypes";
import type { AgentSSETransport } from "./agentSSETransport";
import { safeJsonParse } from "../request";
import { useEffect, useState } from "react";
import { THREAD_RENAME_EVENT } from "@/components/Sidebar/ActiveWorkspaces/ThreadContainer";
import { reduceAgentRunState } from "./agentRunState.ts";
import { legacyEventFromAgentRun } from "./agentLegacyEvent.ts";
export { reduceAgentRunState } from "./agentRunState.ts";
export {
  AgentSSETransport,
  createAgentSSETransport,
} from "./agentSSETransport";

export const AGENT_SESSION_START = "agentSessionStart";
export const AGENT_SESSION_END = "agentSessionEnd";

// Citations arrive as a terminal websocket event that must match an existing message by
// uuid. On a thread's first message the empty->chat transition remounts the chat and
// replays the send, so the citations event can land before its message exists in history.
// Buffer by uuid (module scope survives the remount) and attach when the message appears.
const bufferedCitations = new Map<
  string,
  import("./messages").CitationChunk[]
>();
function takeBufferedCitations(uuid?: string) {
  if (!uuid || !bufferedCitations.has(uuid)) return [];
  const citations = bufferedCitations.get(uuid);
  bufferedCitations.delete(uuid);
  return citations ?? [];
}
const handledEvents = [
  "statusResponse",
  "fileDownloadCard",
  "scheduledJobCreated",
  "awaitingFeedback",
  "wssFailure",
  "rechartVisualize",
  "toolApprovalRequest",
  "clarificationRequest",
  // Streaming events
  "reportStreamEvent",
];

function updateExecutionState(
  history: ChatMessage[],
  runId: string | undefined,
  event: AgentRunEvent | undefined
) {
  if (!runId || !event) return history;
  return history.map((entry) =>
    entry.type === "agentExecution" && entry.agentRunId === runId
      ? {
          ...entry,
          agentRunState: reduceAgentRunState(entry.agentRunState, event),
        }
      : entry
  );
}

export default function handleSocketResponse(
  socket: Pick<AgentSSETransport, "supportsAgentStreaming">,
  event: MessageEvent<string>,
  setChatHistory: (update: (previous: ChatMessage[]) => ChatMessage[]) => void
) {
  const wire = safeJsonParse<Parameters<typeof legacyEventFromAgentRun>[0]>(
    event.data,
    null
  );
  if (!wire || typeof wire !== "object") return;
  const data = legacyEventFromAgentRun(wire);
  if (data === null) return;

  if (data.type === "agentRunEvent") {
    const { runId, event: runEvent } = data.content || {};
    if (!runId || !runEvent) return;
    return setChatHistory((prev) => {
      const uuid = `${runId}:execution`;
      const index = prev.findIndex((message) => message.uuid === uuid);
      const current = index >= 0 ? prev[index].agentRunState : { runId };
      const agentRunState = reduceAgentRunState(current, runEvent);
      const message = {
        uuid,
        type: "agentExecution",
        content: agentRunState.summary,
        agentRunId: runId,
        agentRunState,
        role: "assistant",
        closed: ["completed", "partial", "failed", "cancelled"].includes(
          agentRunState.status
        ),
        animate: false,
        pending: !["completed", "partial", "failed", "cancelled"].includes(
          agentRunState.status
        ),
        sources: [],
        metrics: {},
      };
      const next: ChatMessage[] =
        index >= 0
          ? prev.map((entry, entryIndex) =>
              entryIndex === index ? message : entry
            )
          : [...prev.filter((entry) => !!entry.content), message];
      if (runEvent.type === "input.requested") {
        if (
          next.some(
            (entry) =>
              entry.type === "clarifyingQuestion" &&
              entry.requestId === runEvent.payload?.requestId
          )
        )
          return next;
        return [
          ...next,
          {
            uuid: `${runId}:clarification:${runEvent.payload?.requestId}`,
            type: "clarifyingQuestion",
            requestId: runEvent.payload?.requestId,
            questions: runEvent.payload?.questions || [],
            allowSkip: runEvent.payload?.allowSkip !== false,
            timeoutMs: runEvent.payload?.timeoutMs,
            content: "需要补充信息",
            role: "assistant",
            sources: [],
            closed: false,
            error: null,
            animate: false,
            pending: true,
            metrics: {},
          },
        ];
      }
      if (runEvent.type === "input.resolved") {
        return next.map((entry) =>
          entry.type === "clarifyingQuestion" &&
          entry.requestId === runEvent.payload?.requestId
            ? {
                ...entry,
                resolved: true,
                resolution: {
                  skipped: Boolean(runEvent.payload?.skipped),
                  ...(Array.isArray(runEvent.payload?.answers)
                    ? { answers: runEvent.payload.answers }
                    : { resolved: true }),
                },
                closed: true,
                pending: false,
              }
            : entry
        );
      }
      if (["run.completed", "run.partial"].includes(runEvent.type)) {
        return next.map((entry) =>
          entry.uuid === `${runId}:assistant`
            ? {
                ...entry,
                ...(runEvent.payload?.sources?.length
                  ? { sources: runEvent.payload.sources }
                  : {}),
                ...(runEvent.payload?.outputs?.length
                  ? { outputs: runEvent.payload.outputs }
                  : {}),
              }
            : entry
        );
      }
      return next;
    });
  }

  // A server-owned lifecycle status is updated in place so there is always one
  // concise line describing the active operation. Detailed statusResponse
  // events remain available as the expandable working trace.
  if (data.type === "agentStatus") {
    const status = data.content || {};
    if (!status.uuid || !status.summary) return;
    const terminalStatus =
      status.active === false ||
      ["finalizing", "completed"].includes(status.phase ?? "");
    if (terminalStatus) {
      return setChatHistory((prev) =>
        prev.filter((msg) => msg.type !== "agentStatus")
      );
    }
    return setChatHistory((prev) => [
      ...prev.filter((msg) => msg.type !== "agentStatus"),
      {
        uuid: status.uuid,
        type: "agentStatus",
        content: status.summary,
        phase: status.phase || "working",
        active: true,
        role: "assistant",
        sources: [],
        closed: false,
        error: null,
        animate: true,
        pending: true,
        metrics: {},
      },
    ]);
  }

  // Handle thread rename
  if (data.type === "rename_thread") {
    const { slug, name } = data.content || {};
    if (slug && name) {
      window.dispatchEvent(
        new CustomEvent(THREAD_RENAME_EVENT, {
          detail: { threadSlug: slug, newName: name },
        })
      );
    }
    return;
  }

  // No message type is defined then this is a generic message
  // that we need to print to the user as a system response
  if (!data.hasOwnProperty("type") && !socket.supportsAgentStreaming) {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: {},
        },
      ];
    });
  }

  // toolApprovalRequest doesn't have content field, so check separately
  if (data.type === "toolApprovalRequest") {
    if (!data.requestId || !data.skillName) return;
  } else if (data.type === "clarificationRequest") {
    if (!data.requestId || !Array.isArray(data.questions)) return;
  } else if (!handledEvents.includes(data.type ?? "") || !data.content) {
    return;
  }

  if (data.type === "reportStreamEvent") {
    // Enable agent streaming for the next message so we can handle streaming or non-streaming responses
    // If we get this message we know the provider supports agentic streaming
    socket.supportsAgentStreaming = true;

    return setChatHistory((prev) => {
      const withAgentState = (history: ChatMessage[]) =>
        updateExecutionState(
          history,
          data.content.agentRunId,
          data.content.agentRunEvent
        );
      if (data.content.type === "removeStatusResponse")
        return [...prev.filter((msg) => msg.uuid !== data.content.uuid)];

      if (data.content.type === "modelRouteNotification") {
        if (!data.content.routedTo) return prev;
        return [
          ...prev.filter(
            (msg) => !(msg.role === "assistant" && msg.pending && !msg.content)
          ),
          {
            uuid: data.content.uuid,
            type: "modelRouteNotification",
            content: "modelRouteNotification",
            routedTo: data.content.routedTo,
          },
        ];
      }

      if (data.content.type === "subagentEvent") {
        const { uuid, run } = data.content;
        if (!uuid || !run) return prev;
        const message = {
          uuid,
          type: "subagentRun",
          content: run.task || run.agent?.name || "Subagent",
          subagentRun: run,
          role: "assistant",
          sources: [],
          closed: run.status !== "running",
          error: run.error || null,
          animate: run.status === "running",
          pending: run.status === "running",
          metrics: {},
        };
        return prev.some((entry) => entry.uuid === uuid)
          ? prev.map((entry) => (entry.uuid === uuid ? message : entry))
          : [...prev.filter((entry) => !!entry.content), message];
      }

      if (data.content.type === "contextTrace") {
        const { uuid, trace } = data.content;
        if (!uuid || !trace) return prev;
        const message = {
          uuid,
          type: "contextTrace",
          content: trace.title || "Context used",
          contextTrace: trace,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: {},
        };
        return prev.some((entry) => entry.uuid === uuid)
          ? prev.map((entry) => (entry.uuid === uuid ? message : entry))
          : [...prev.filter((entry) => !!entry.content), message];
      }

      // Handle citations independently of message creation order. If the target message
      // exists, attach now or buffer until it is created.
      if (data.content.type === "citations") {
        const { uuid, citations } = data.content;
        if (!citations || !uuid) return prev;
        let attached = false;
        const next = prev.map((msg) => {
          if (msg.uuid !== uuid) return msg;
          attached = true;
          return { ...msg, sources: [...(msg.sources || []), ...citations] };
        });
        if (!attached) bufferedCitations.set(uuid, citations);
        return next;
      }

      const knownMessage = data.content.uuid
        ? prev.find((msg) => msg.uuid === data.content.uuid)
        : null;
      if (!knownMessage) {
        if (data.content.type === "fullTextResponse") {
          return withAgentState([
            ...prev.filter((msg) => !!msg.content),
            {
              uuid: data.content.uuid,
              type: "textResponse",
              content: data.content.content,
              role: "assistant",
              sources: takeBufferedCitations(data.content.uuid),
              closed: true,
              error: null,
              animate: false,
              pending: false,
              metrics: {},
            },
          ]);
        }

        // Handle textResponseChunk initialization as textResponse instead of statusResponse.
        // Without this the first chunk creates a statusResponse (thought bubble) by falling through to the default case.
        // Providers like Gemini send large chunks and can complete in a single chunk before the update logic can convert it.
        // Other providers send many small chunks so the second chunk triggers the update logic to fix the type.
        if (data.content.type === "textResponseChunk") {
          // If this first chunk is just a non-text char (like \n, \t, etc.) then we need to ignore it.
          // Some providers like LMStudio will do this and it depends on the chat template as well.
          if (
            typeof data.content.content !== "string" ||
            data.content.content.trim() === ""
          )
            return prev;
          return withAgentState([
            ...prev.filter((msg) => !!msg.content),
            {
              uuid: data.content.uuid,
              type: "textResponse",
              content: data.content.content,
              role: "assistant",
              sources: takeBufferedCitations(data.content.uuid),
              closed: true,
              error: null,
              animate: false,
              pending: false,
              metrics: {},
              agentRunId: data.content.agentRunId,
            },
          ]);
        }

        return [
          ...prev.filter((msg) => !!msg.content),
          {
            uuid: data.content.uuid,
            type: "statusResponse",
            content: data.content.content,
            role: "assistant",
            sources: [],
            closed: true,
            error: null,
            animate: false,
            pending: false,
            metrics: {},
          },
        ];
      } else {
        const { type, content, uuid } = data.content;
        // For tool call invocations, we need to update the existing message entirely since it is accumulated
        // and we dont know if the function will have arguments or not while streaming - so replace the existing message entirely
        if (type === "toolCallInvocation") {
          const knownMessage = prev.find((msg) => msg.uuid === uuid);
          if (!knownMessage)
            return [...prev, { uuid, type: "toolCallInvocation", content }]; // If the message is not known, add it to the end of the list
          return [
            ...prev.filter((msg) => msg.uuid !== uuid),
            { ...knownMessage, content },
          ]; // If the message is known, replace it with the new content
        }

        if (type === "usageMetrics") {
          if (!data.content.metrics) return prev;
          return prev.map((msg) =>
            msg.uuid === uuid ? { ...msg, metrics: data.content.metrics } : msg
          );
        }

        if (type === "chatId") {
          if (!data.content.chatId) return prev;
          const assistantIdx = prev.findIndex((msg) => msg.uuid === uuid);
          if (assistantIdx === -1) return prev;
          const userIdx = prev
            .slice(0, assistantIdx)
            .map((msg) => msg.role)
            .lastIndexOf("user");
          const turnTraces = prev
            .slice(userIdx + 1)
            .flatMap((msg) =>
              msg.type === "contextTrace" && msg.contextTrace
                ? [msg.contextTrace]
                : []
            );
          return withAgentState(
            prev
              .filter((msg, i) => !(i > userIdx && msg.type === "contextTrace"))
              .map((msg) => {
                if (msg.uuid === uuid) {
                  const existing = Array.isArray(msg.contextTraces)
                    ? msg.contextTraces
                    : [];
                  const seen = new Set(existing.map((trace) => trace.id));
                  return {
                    ...msg,
                    chatId: data.content.chatId,
                    ...(Array.isArray(data.content.outputs)
                      ? { outputs: data.content.outputs }
                      : {}),
                    ...(Array.isArray(data.content.parts)
                      ? { messageParts: data.content.parts }
                      : {}),
                    contextTraces: [
                      ...existing,
                      ...turnTraces.filter((trace) => !seen.has(trace.id)),
                    ],
                  };
                }
                if (msg === prev[userIdx])
                  return { ...msg, chatId: data.content.chatId };
                return msg;
              })
          );
        }

        if (type === "textResponseChunk") {
          return withAgentState(
            prev
              .map((msg) =>
                msg.uuid === uuid
                  ? {
                      ...msg,
                      type: "textResponse",
                      content: String(msg.content) + String(content),
                      agentRunId:
                        data.content.agentRunId || msg.agentRunId || null,
                    }
                  : msg?.content
                    ? msg
                    : null
              )
              .filter((msg) => !!msg)
          );
        }

        // Generic text response - will be put in the agent thought bubble
        return prev.map((msg) =>
          msg.uuid === data.content.uuid
            ? {
                ...msg,
                content: String(msg.content) + String(data.content.content),
              }
            : msg
        );
      }
    });
  }

  if (data.type === "fileDownloadCard") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          type: "fileDownloadCard",
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: data.metrics || {},
        },
      ];
    });
  }

  if (data.type === "scheduledJobCreated") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          type: "scheduledJobCreated",
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: data.metrics || {},
        },
      ];
    });
  }

  if (data.type === "rechartVisualize") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          type: "rechartVisualize",
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: null,
          animate: false,
          pending: false,
          metrics: data.metrics || {},
        },
      ];
    });
  }

  if (data.type === "wssFailure") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          content: data.content,
          role: "assistant",
          sources: [],
          closed: true,
          error: data.content,
          animate: false,
          pending: false,
          metrics: {},
        },
      ];
    });
  }

  if (data.type === "toolApprovalRequest") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          type: "toolApprovalRequest",
          requestId: data.requestId,
          skillName: data.skillName,
          payload: data.payload,
          description: data.description,
          timeoutMs: data.timeoutMs,
          content: `Approval requested for ${data.skillName}`,
          role: "assistant",
          sources: [],
          closed: false,
          error: null,
          animate: false,
          pending: true,
          metrics: {},
        },
      ];
    });
  }

  if (data.type === "clarificationRequest") {
    return setChatHistory((prev) => {
      return [
        ...prev.filter((msg) => !!msg.content),
        {
          uuid: v4(),
          type: "clarifyingQuestion",
          requestId: data.requestId,
          questions: data.questions || [],
          allowSkip: data.allowSkip !== false,
          timeoutMs: data.timeoutMs,
          content: `Agent has ${data.questions?.length || 0} question${
            (data.questions?.length || 0) === 1 ? "" : "s"
          }`,
          role: "assistant",
          sources: [],
          closed: false,
          error: null,
          animate: false,
          pending: true,
          metrics: {},
        },
      ];
    });
  }

  return setChatHistory((prev) => {
    return [
      ...prev.filter((msg) => !!msg.content),
      {
        uuid: v4(),
        type: data.type,
        content: data.content,
        role: "assistant",
        sources: [],
        closed: true,
        error: null,
        animate: data?.animate || false,
        pending: false,
        metrics: data.metrics || {},
      },
    ];
  });
}

let _agentSessionActive = false;
export function setAgentSessionActive(value: boolean) {
  _agentSessionActive = value;
}
export function getAgentSessionActive() {
  return _agentSessionActive;
}

// Live agent-session websocket, used to toggle tools available to the agent mid-session.
let _agentSessionSocket: Pick<AgentSSETransport, "readyState" | "send"> | null =
  null;
export function setAgentSessionSocket(socket: typeof _agentSessionSocket) {
  _agentSessionSocket = socket;
}

/**
 * Toggle a tool/skill on or off for the active agent session over the websocket.
 * No-op when there is no open agent session.
 * @param {string} skill - Skill key, MCP `<server>-<tool>`, hubId, or sub-skill name.
 * @param {boolean} enabled - Whether the tool should be enabled.
 * @param {string|null} [serverName] - MCP server name; required to enable an MCP tool mid-session.
 */
export function toggleAgentSessionTool(
  skill: string,
  enabled: boolean,
  serverName: string | null = null
) {
  if (_agentSessionSocket?.readyState !== WebSocket.OPEN) return;
  _agentSessionSocket.send(
    JSON.stringify({ type: "agentToolToggle", skill, enabled, serverName })
  );
}

export function useIsAgentSessionActive() {
  const [activeSession, setActiveSession] = useState(
    () => !!getAgentSessionActive()
  );
  useEffect(() => {
    const handleSessionStart = () => setActiveSession(true);
    const handleSessionEnd = () => setActiveSession(false);
    window.addEventListener(AGENT_SESSION_START, handleSessionStart);
    window.addEventListener(AGENT_SESSION_END, handleSessionEnd);
    return () => {
      window.removeEventListener(AGENT_SESSION_START, handleSessionStart);
      window.removeEventListener(AGENT_SESSION_END, handleSessionEnd);
    };
  }, []);

  return activeSession;
}
