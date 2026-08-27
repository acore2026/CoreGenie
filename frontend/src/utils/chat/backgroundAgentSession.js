import handleSocketResponse, {
  AGENT_SESSION_END,
  AGENT_SESSION_START,
  createAgentSSETransport,
} from "./agent";
import {
  updateConversationHistory,
  updateConversationRuntime,
} from "./conversationRuntime";

const sessions = new Map();
const listeners = new Map();

function snapshot(session) {
  if (!session)
    return {
      active: false,
      connecting: false,
      transport: null,
      socketId: null,
    };
  return {
    active: session.active,
    connecting: session.connecting,
    transport: session.transport,
    socketId: session.socketId,
    error: session.error,
  };
}

function notify(key) {
  const value = snapshot(sessions.get(key));
  for (const listener of listeners.get(key) || []) listener(value);
}

function updateAgentActivity(
  key,
  socketId,
  { summary, phase = "working", active = true, error = null }
) {
  updateConversationHistory(key, (previous) => [
    ...previous.filter((message) => message.type !== "agentStatus"),
    {
      uuid: `agent-status:${socketId}`,
      type: "agentStatus",
      content: summary,
      phase,
      active,
      role: "assistant",
      sources: [],
      closed: !active,
      error,
      animate: active,
      pending: active,
      metrics: {},
    },
  ]);
}

function closeSession(session, { failed = false, message = null } = {}) {
  if (session.closed) return;
  session.closed = true;
  session.active = false;
  session.connecting = false;
  session.transport = null;
  session.error = message;

  if (failed) {
    updateAgentActivity(session.key, session.socketId, {
      summary: message || "Unable to establish an Agent session",
      phase: "error",
      active: false,
      error: message,
    });
  } else {
    updateConversationHistory(session.key, (previous) =>
      previous.filter((message) => message.type !== "agentStatus")
    );
  }
  updateConversationRuntime(session.key, {
    loadingResponse: false,
    socketId: null,
  });
  notify(session.key);
}

function attachTransport(session, transport) {
  session.transport = transport;
  transport.supportsAgentStreaming = false;
  let opened = transport.readyState === WebSocket.OPEN;

  transport.addEventListener("open", () => {
    if (session.closed || session.transport !== transport) return;
    opened = true;
    session.active = true;
    session.connecting = false;
    updateAgentActivity(session.key, session.socketId, {
      summary: "Starting Agent session",
      phase: "starting",
    });
    updateConversationRuntime(session.key, { loadingResponse: false });
    notify(session.key);
  });

  transport.addEventListener("message", (event) => {
    if (session.closed || session.transport !== transport) return;
    try {
      handleSocketResponse(transport, event, (updater) =>
        updateConversationHistory(session.key, updater)
      );
    } catch (error) {
      console.error("Failed to parse Agent transport data", error);
      transport.close();
    }
  });

  transport.addEventListener("close", () => {
    if (session.closed || session.transport !== transport) return;
    closeSession(session, {
      failed: !opened,
      message: !opened ? "Agent SSE fallback connection failed." : null,
    });
  });

  if (opened) {
    session.active = true;
    session.connecting = false;
    updateConversationRuntime(session.key, { loadingResponse: false });
    notify(session.key);
  }
}

function startSSE(session) {
  if (session.closed) return;
  attachTransport(session, createAgentSSETransport(session.socketId));
}

export function ensureBackgroundAgentSession({ key, socketId }) {
  const existing = sessions.get(key);
  if (existing && existing.socketId === socketId && !existing.closed) {
    notify(key);
    return snapshot(existing);
  }

  if (existing && !existing.closed) stopBackgroundAgentSession(key);
  const session = {
    key,
    socketId,
    transport: null,
    active: false,
    connecting: true,
    closed: false,
    error: null,
  };
  sessions.set(key, session);
  updateConversationRuntime(key, { socketId });
  notify(key);
  startSSE(session);
  return snapshot(session);
}

export function subscribeBackgroundAgentSession(key, listener) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
  listener(snapshot(sessions.get(key)));
  return () => {
    const subscribers = listeners.get(key);
    subscribers?.delete(listener);
    if (subscribers?.size === 0) listeners.delete(key);
  };
}

export function stopBackgroundAgentSession(key) {
  const session = sessions.get(key);
  if (!session || session.closed) return false;
  const transport = session.transport;
  if (transport?.readyState === WebSocket.OPEN) {
    transport.send(
      JSON.stringify({ type: "awaitingFeedback", feedback: "/exit" })
    );
  }
  window.setTimeout(() => {
    if (!session.closed && session.transport === transport) transport?.close();
  }, 250);
  return true;
}

export function bindVisibleAgentSession(key, onChange) {
  let wasActive = false;
  return subscribeBackgroundAgentSession(key, (state) => {
    if (state.active !== wasActive) {
      window.dispatchEvent(
        new CustomEvent(state.active ? AGENT_SESSION_START : AGENT_SESSION_END)
      );
      wasActive = state.active;
    }
    onChange(state);
  });
}
