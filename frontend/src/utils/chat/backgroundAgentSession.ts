import handleSocketResponse, {
  AGENT_SESSION_END,
  AGENT_SESSION_START,
  createAgentSSETransport,
} from "./agent";
import {
  updateConversationHistory,
  updateConversationRuntime,
} from "./conversationRuntime";

type Transport = ReturnType<typeof createAgentSSETransport>;
interface Session {
  key: string;
  socketId: string;
  transport: Transport | null;
  active: boolean;
  connecting: boolean;
  closed: boolean;
  error: string | null;
}
type Listener = (state: ReturnType<typeof snapshot>) => void;
const sessions = new Map<string, Session>();
const listeners = new Map<string, Set<Listener>>();

function snapshot(session?: Session) {
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

function notify(key: string) {
  const value = snapshot(sessions.get(key));
  for (const listener of listeners.get(key) || []) listener(value);
}

function updateAgentActivity(
  key: string,
  socketId: string,
  {
    summary,
    phase = "working",
    active = true,
    error = null,
  }: {
    summary: string;
    phase?: string;
    active?: boolean;
    error?: string | null;
  }
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

function closeSession(
  session: Session,
  {
    failed = false,
    message = null,
  }: { failed?: boolean; message?: string | null } = {}
) {
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

function attachTransport(session: Session, transport: Transport) {
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
      if (!(event instanceof MessageEvent)) return;
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

function startSSE(session: Session) {
  if (session.closed) return;
  attachTransport(session, createAgentSSETransport(session.socketId));
}

export function ensureBackgroundAgentSession({
  key,
  socketId,
}: {
  key: string;
  socketId: string;
}) {
  const existing = sessions.get(key);
  if (existing && existing.socketId === socketId && !existing.closed) {
    notify(key);
    return snapshot(existing);
  }

  if (existing && !existing.closed) stopBackgroundAgentSession(key);
  const session: Session = {
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

export function subscribeBackgroundAgentSession(
  key: string,
  listener: Listener
) {
  const subscribers = listeners.get(key) ?? new Set<Listener>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  listener(snapshot(sessions.get(key)));
  return () => {
    const subscribers = listeners.get(key);
    subscribers?.delete(listener);
    if (subscribers?.size === 0) listeners.delete(key);
  };
}

export function stopBackgroundAgentSession(key: string) {
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

export function bindVisibleAgentSession(key: string, onChange: Listener) {
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
