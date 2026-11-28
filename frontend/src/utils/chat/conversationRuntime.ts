import type { ChatMessage } from "./messages";
interface Runtime {
  history: ChatMessage[];
  loadingResponse: boolean;
  requestInFlight: boolean;
  socketId: string | null;
}
type Listener = (runtime: Runtime) => void;
const runtimes = new Map<string, Runtime>();
const listeners = new Map<string, Set<Listener>>();

export function conversationRuntimeKey(
  workspaceSlug: string,
  threadSlug: string | null,
  userId: number | undefined
) {
  return JSON.stringify([userId ?? null, workspaceSlug, threadSlug]);
}

function notify(key: string) {
  const snapshot = runtimes.get(key);
  if (!snapshot) return;
  for (const listener of listeners.get(key) || []) listener(snapshot);
}

export function initializeConversationRuntime(
  key: string,
  history: ChatMessage[] = []
) {
  const existing = runtimes.get(key);
  if (existing) return existing;

  const runtime = {
    history,
    loadingResponse: false,
    requestInFlight: false,
    socketId: null,
  };
  runtimes.set(key, runtime);
  return runtime;
}

export function getConversationRuntime(key: string) {
  return runtimes.get(key) || null;
}

export function subscribeConversationRuntime(key: string, listener: Listener) {
  const subscribers = listeners.get(key) ?? new Set<Listener>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  const current = runtimes.get(key);
  if (current) listener(current);

  return () => {
    const subscribers = listeners.get(key);
    subscribers?.delete(listener);
    if (subscribers?.size === 0) listeners.delete(key);
  };
}

export function updateConversationRuntime(
  key: string,
  patch: Partial<Runtime> | ((current: Runtime) => Partial<Runtime>)
) {
  const current = runtimes.get(key) || initializeConversationRuntime(key, []);
  const nextPatch = typeof patch === "function" ? patch(current) : patch;
  const next = { ...current, ...nextPatch };
  runtimes.set(key, next);
  notify(key);
  return next;
}

export function updateConversationHistory(
  key: string,
  updater: ChatMessage[] | ((history: ChatMessage[]) => ChatMessage[])
) {
  return updateConversationRuntime(key, (current) => ({
    history: typeof updater === "function" ? updater(current.history) : updater,
  })).history;
}

export function claimConversationRequest(key: string) {
  const current = runtimes.get(key);
  if (!current || current.requestInFlight) return false;
  updateConversationRuntime(key, { requestInFlight: true });
  return true;
}

export function releaseConversationRequest(key: string) {
  const current = runtimes.get(key);
  if (!current?.requestInFlight) return;
  updateConversationRuntime(key, { requestInFlight: false });
}
