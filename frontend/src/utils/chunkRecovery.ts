export const CHUNK_RECOVERY_STORAGE_KEY = "coregenie_chunk_recovery";
export const CHUNK_RECOVERY_COOLDOWN_MS = 60_000;

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\d-]+ failed/i,
  /chunkloaderror/i,
];

let reloadPending = false;

function messageOf(value: unknown) {
  return value && typeof value === "object" && "message" in value
    ? value.message
    : null;
}

export function isDynamicImportError(error: unknown) {
  const messages: unknown[] = [error, messageOf(error)];
  if (error && typeof error === "object") {
    if ("reason" in error) messages.push(messageOf(error.reason));
    if ("payload" in error) messages.push(messageOf(error.payload));
  }
  return messages.some(
    (message) =>
      typeof message === "string" &&
      DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  );
}

export function claimChunkRecovery({
  storage,
  href,
  now = Date.now(),
  cooldownMs = CHUNK_RECOVERY_COOLDOWN_MS,
}: {
  storage: Pick<Storage, "getItem" | "setItem">;
  href: string;
  now?: number;
  cooldownMs?: number;
}) {
  if (!storage || !href) return false;

  try {
    const previous = JSON.parse(
      storage.getItem(CHUNK_RECOVERY_STORAGE_KEY) || "null"
    );
    const recentlyRetried =
      previous?.href === href &&
      Number.isFinite(previous?.attemptedAt) &&
      now - previous.attemptedAt >= 0 &&
      now - previous.attemptedAt < cooldownMs;
    if (recentlyRetried) return false;

    storage.setItem(
      CHUNK_RECOVERY_STORAGE_KEY,
      JSON.stringify({ href, attemptedAt: now })
    );
    return true;
  } catch {
    return false;
  }
}

export function clearChunkRecovery(storage = window.sessionStorage) {
  try {
    storage.removeItem(CHUNK_RECOVERY_STORAGE_KEY);
  } catch {}
}

export function recoverFromChunkError(error: unknown, { force = false } = {}) {
  if ((!force && !isDynamicImportError(error)) || reloadPending) {
    return reloadPending;
  }

  const claimed = claimChunkRecovery({
    storage: window.sessionStorage,
    href: window.location.href,
  });
  if (!claimed) return false;

  reloadPending = true;
  window.location.reload();
  return true;
}

export function installChunkRecovery() {
  const handlePreloadError = (event: Event) => {
    event.preventDefault();
    recoverFromChunkError("payload" in event ? event.payload : event, {
      force: true,
    });
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (!isDynamicImportError(event.reason)) return;
    event.preventDefault();
    recoverFromChunkError(event.reason);
  };

  window.addEventListener("vite:preloadError", handlePreloadError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);

  return () => {
    window.removeEventListener("vite:preloadError", handlePreloadError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}
