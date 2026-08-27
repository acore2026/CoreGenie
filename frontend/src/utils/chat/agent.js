import { v4 } from "uuid";
import { safeJsonParse } from "../request";
import { API_BASE } from "../constants";
import { useEffect, useState } from "react";
import { emitAssistantMessageCompleteEvent } from "@/components/contexts/TTSProvider";
import { THREAD_RENAME_EVENT } from "@/components/Sidebar/ActiveWorkspaces/ThreadContainer";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { baseHeaders } from "../request";

export const AGENT_SESSION_START = "agentSessionStart";
export const AGENT_SESSION_END = "agentSessionEnd";

// Citations arrive as a terminal websocket event that must match an existing message by
// uuid. On a thread's first message the empty->chat transition remounts the chat and
// replays the send, so the citations event can land before its message exists in history.
// Buffer by uuid (module scope survives the remount) and attach when the message appears.
const bufferedCitations = new Map();
function takeBufferedCitations(uuid) {
  if (!uuid || !bufferedCitations.has(uuid)) return [];
  const citations = bufferedCitations.get(uuid);
  bufferedCitations.delete(uuid);
  return citations;
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

/** Browser-side SSE transport with authenticated POST commands. */
export class AgentSSETransport extends EventTarget {
  constructor(uuid) {
    super();
    this.uuid = uuid;
    this.readyState = WebSocket.CONNECTING;
    this.supportsAgentStreaming = false;
    this.controller = new AbortController();
    this.#connect();
  }

  async #connect() {
    try {
      await fetchEventSource(`${API_BASE}/agent-runs/${this.uuid}/events`, {
        method: "GET",
        headers: baseHeaders(),
        signal: this.controller.signal,
        openWhenHidden: true,
        onopen: async (response) => {
          if (!response.ok)
            throw new Error(
              `Agent SSE connection failed with status ${response.status}.`
            );
          this.readyState = WebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        },
        onmessage: (message) => {
          this.dispatchEvent(
            new MessageEvent("message", { data: message.data })
          );
        },
        onclose: () => this.#finish(),
        onerror: (error) => {
          throw error;
        },
      });
    } catch (error) {
      if (this.controller.signal.aborted) return this.#finish();
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
      this.#finish();
    }
  }

  send(jsonData) {
    if (this.readyState !== WebSocket.OPEN) return;
    const message = safeJsonParse(jsonData, {});
    const command = ["stop", "cancel", "/exit"].includes(
      message?.feedback || message?.type
    )
      ? { type: "cancel" }
      : message;
    fetch(`${API_BASE}/agent-runs/${this.uuid}/commands`, {
      method: "POST",
      headers: { ...baseHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(command),
    })
      .then((response) => {
        if (response.ok) return;
        throw new Error(`Agent message failed with status ${response.status}.`);
      })
      .catch((error) => {
        this.dispatchEvent(new CustomEvent("error", { detail: error }));
      });
  }

  close() {
    if (
      this.readyState === WebSocket.CLOSING ||
      this.readyState === WebSocket.CLOSED
    )
      return;
    this.readyState = WebSocket.CLOSING;
    this.controller.abort();
    this.#finish();
  }

  #finish() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

function legacyEventFromAgentRun(event) {
  if (!event?.runId || !event?.type || !event?.payload) return event;
  const { runId, type, payload } = event;
  if (type === "activity.updated")
    return {
      type: "agentStatus",
      content: {
        uuid: `${runId}:status`,
        summary: payload.summary,
        phase: payload.phase,
        active: payload.phase !== "complete",
      },
    };
  if (type === "message.delta")
    return {
      type: "reportStreamEvent",
      content: {
        type: "textResponseChunk",
        uuid: payload.messageId,
        content: payload.delta,
      },
    };
  if (type === "message.completed")
    return {
      type: "reportStreamEvent",
      content: {
        type: "chatId",
        uuid: payload.messageId,
        chatId: payload.chatId,
      },
    };
  if (type === "context.memory.recalled")
    return {
      type: "reportStreamEvent",
      content: {
        type: "contextTrace",
        uuid: `${runId}:memory:${event.id}`,
        trace: {
          id: `${runId}:memory:${event.id}`,
          kind: "memory",
          title: `Recalled ${payload.count} memories`,
          details: payload.memories,
        },
      },
    };
  if (type === "context.rag.recalled")
    return {
      type: "reportStreamEvent",
      content: {
        type: "contextTrace",
        uuid: `${runId}:rag:${event.id}`,
        trace: {
          id: `${runId}:rag:${event.id}`,
          kind: "rag",
          title: `Used ${payload.count} knowledge sources`,
          details: payload.sources,
        },
      },
    };
  if (
    ["subagent.started", "subagent.completed", "subagent.failed"].includes(type)
  )
    return {
      type: "reportStreamEvent",
      content: {
        type: "subagentEvent",
        uuid: `${runId}:subagent:${payload.childRunId}`,
        run: {
          id: payload.childRunId,
          task: payload.task,
          agent: payload.agent,
          depth: payload.depth,
          response: payload.response,
          error: payload.error,
          status:
            type === "subagent.started"
              ? "running"
              : type === "subagent.completed"
                ? "completed"
                : "failed",
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
  if (type === "input.requested")
    return {
      type: "clarificationRequest",
      requestId: payload.requestId,
      questions: payload.questions,
    };
  if (type === "thread.renamed")
    return { type: "rename_thread", content: payload };
  if (type === "run.failed")
    return {
      type: "wssFailure",
      content: payload.error || "Agent run failed.",
    };
  if (type === "run.cancelled")
    return { type: "wssFailure", content: "Agent run cancelled." };
  return null;
}

export function createAgentSSETransport(uuid) {
  return new AgentSSETransport(uuid);
}

export default function handleSocketResponse(socket, event, setChatHistory) {
  let data = safeJsonParse(event.data, null);
  if (data === null) return;
  data = legacyEventFromAgentRun(data);
  if (data === null) return;

  // A server-owned lifecycle status is updated in place so there is always one
  // concise line describing the active operation. Detailed statusResponse
  // events remain available as the expandable working trace.
  if (data.type === "agentStatus") {
    const status = data.content || {};
    if (!status.uuid || !status.summary) return;
    const terminalStatus =
      status.active === false ||
      ["finalizing", "completed"].includes(status.phase);
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
        active: status.active !== false,
        role: "assistant",
        sources: [],
        closed: status.active === false,
        error: null,
        animate: status.active !== false,
        pending: status.active !== false,
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
  } else if (!handledEvents.includes(data.type) || !data.content) {
    return;
  }

  if (data.type === "reportStreamEvent") {
    // Enable agent streaming for the next message so we can handle streaming or non-streaming responses
    // If we get this message we know the provider supports agentic streaming
    socket.supportsAgentStreaming = true;

    // trigger TTS auto-play
    if (data.content?.type === "chatId" && data.content?.chatId)
      emitAssistantMessageCompleteEvent(data.content.chatId);

    return setChatHistory((prev) => {
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
        if (!citations) return prev;
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
          return [
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
          ];
        }

        // Handle textResponseChunk initialization as textResponse instead of statusResponse.
        // Without this the first chunk creates a statusResponse (thought bubble) by falling through to the default case.
        // Providers like Gemini send large chunks and can complete in a single chunk before the update logic can convert it.
        // Other providers send many small chunks so the second chunk triggers the update logic to fix the type.
        if (data.content.type === "textResponseChunk") {
          // If this first chunk is just a non-text char (like \n, \t, etc.) then we need to ignore it.
          // Some providers like LMStudio will do this and it depends on the chat template as well.
          if (data.content.content.trim() === "") return prev;
          return [
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
          ];
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
          const userIdx = prev.findLastIndex(
            (msg, i) => i < assistantIdx && msg.role === "user"
          );
          const turnTraces = prev
            .slice(userIdx + 1)
            .filter((msg) => msg.type === "contextTrace" && msg.contextTrace)
            .map((msg) => msg.contextTrace);
          return prev
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
                  contextTraces: [
                    ...existing,
                    ...turnTraces.filter((trace) => !seen.has(trace.id)),
                  ],
                };
              }
              if (msg === prev[userIdx])
                return { ...msg, chatId: data.content.chatId };
              return msg;
            });
        }

        if (type === "textResponseChunk") {
          return prev
            .map((msg) =>
              msg.uuid === uuid
                ? {
                    ...msg,
                    type: "textResponse",
                    content: msg.content + content,
                  }
                : msg?.content
                  ? msg
                  : null
            )
            .filter((msg) => !!msg);
        }

        // Generic text response - will be put in the agent thought bubble
        return prev.map((msg) =>
          msg.uuid === data.content.uuid
            ? { ...msg, content: msg.content + data.content.content }
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
export function setAgentSessionActive(value) {
  _agentSessionActive = value;
}
export function getAgentSessionActive() {
  return _agentSessionActive;
}

// Live agent-session websocket, used to toggle tools available to the agent mid-session.
let _agentSessionSocket = null;
export function setAgentSessionSocket(socket) {
  _agentSessionSocket = socket;
}

/**
 * Toggle a tool/skill on or off for the active agent session over the websocket.
 * No-op when there is no open agent session.
 * @param {string} skill - Skill key, `@@flow_<uuid>`, MCP `<server>-<tool>`, hubId, or sub-skill name.
 * @param {boolean} enabled - Whether the tool should be enabled.
 * @param {string|null} [serverName] - MCP server name; required to enable an MCP tool mid-session.
 */
export function toggleAgentSessionTool(skill, enabled, serverName = null) {
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
