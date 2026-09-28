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

function errorMessages(error) {
  return [
    error?.message,
    error?.reason?.message,
    error?.payload?.message,
    typeof error === "string" ? error : null,
  ].filter(Boolean);
}

export function isDynamicImportError(error) {
  return errorMessages(error).some((message) =>
    DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  );
}

export function claimChunkRecovery({
  storage,
  href,
  now = Date.now(),
  cooldownMs = CHUNK_RECOVERY_COOLDOWN_MS,
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

export function recoverFromChunkError(error, { force = false } = {}) {
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
  const handlePreloadError = (event) => {
    event.preventDefault();
    recoverFromChunkError(event.payload || event, { force: true });
  };
  const handleUnhandledRejection = (event) => {
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
