const runtimes = new Map();
const listeners = new Map();

export function conversationRuntimeKey(workspaceSlug, threadSlug = null) {
  return `${workspaceSlug}:${threadSlug || "__default__"}`;
}

function notify(key) {
  const snapshot = runtimes.get(key);
  if (!snapshot) return;
  for (const listener of listeners.get(key) || []) listener(snapshot);
}

export function initializeConversationRuntime(key, history = []) {
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

export function getConversationRuntime(key) {
  return runtimes.get(key) || null;
}

export function subscribeConversationRuntime(key, listener) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
  const current = runtimes.get(key);
  if (current) listener(current);

  return () => {
    const subscribers = listeners.get(key);
    subscribers?.delete(listener);
    if (subscribers?.size === 0) listeners.delete(key);
  };
}

export function updateConversationRuntime(key, patch) {
  const current = runtimes.get(key) || initializeConversationRuntime(key, []);
  const nextPatch = typeof patch === "function" ? patch(current) : patch;
  const next = { ...current, ...nextPatch };
  runtimes.set(key, next);
  notify(key);
  return next;
}

export function updateConversationHistory(key, updater) {
  return updateConversationRuntime(key, (current) => ({
    history: typeof updater === "function" ? updater(current.history) : updater,
  })).history;
}

export function claimConversationRequest(key) {
  const current = runtimes.get(key);
  if (!current || current.requestInFlight) return false;
  updateConversationRuntime(key, { requestInFlight: true });
  return true;
}

export function releaseConversationRequest(key) {
  const current = runtimes.get(key);
  if (!current?.requestInFlight) return;
  updateConversationRuntime(key, { requestInFlight: false });
}
