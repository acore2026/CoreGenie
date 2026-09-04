export const NETWORK_PROBE_INTERVAL_MS = 30_000;
export const NETWORK_PROBE_TIMEOUT_MS = 5_000;
export const NETWORK_FAILURE_THRESHOLD = 2;
export const NETWORK_AUTH_REDIRECT_COOLDOWN_MS = 2 * 60_000;
export const NETWORK_AUTH_QUERY_PARAM = "_network_auth";
export const NETWORK_AUTH_RETURN_URL_KEY =
  "anythingllm_network_auth_return_url";
export const NETWORK_AUTH_ATTEMPT_KEY = "anythingllm_network_auth_attempt_at";

export const NETWORK_PROBE_STATUS = Object.freeze({
  healthy: "healthy",
  portal: "portal",
  unavailable: "unavailable",
});

function probeUrl(endpoint, now) {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}_network_probe=${now}`;
}

/**
 * Probe the same-origin API without following redirects. Corporate access
 * portals surface as an opaque redirect in browsers, while a real API
 * response carries both the expected JSON body and our request ID header.
 */
export async function probeNetworkSession({
  fetchFn,
  endpoint,
  timeoutMs = NETWORK_PROBE_TIMEOUT_MS,
  now = Date.now(),
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(probeUrl(endpoint, now), {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });

    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400) ||
      response.redirected
    ) {
      return { status: NETWORK_PROBE_STATUS.portal };
    }

    const contentType = response.headers?.get?.("content-type") || "";
    const requestId = response.headers?.get?.("x-request-id") || "";
    if (
      !response.ok ||
      !contentType.toLowerCase().includes("application/json") ||
      !requestId
    ) {
      return { status: NETWORK_PROBE_STATUS.unavailable };
    }

    const payload = await response.json().catch(() => null);
    return payload?.online === true
      ? { status: NETWORK_PROBE_STATUS.healthy }
      : { status: NETWORK_PROBE_STATUS.unavailable };
  } catch {
    return { status: NETWORK_PROBE_STATUS.unavailable };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function buildNetworkAuthUrl(currentHref, now = Date.now()) {
  const url = new URL(currentHref);
  url.searchParams.set(NETWORK_AUTH_QUERY_PARAM, String(now));
  return url.toString();
}

export function removeNetworkAuthParam(currentHref) {
  const url = new URL(currentHref);
  url.searchParams.delete(NETWORK_AUTH_QUERY_PARAM);
  return url.toString();
}

export function resolveNetworkAuthReturnUrl({
  currentHref,
  storedReturnUrl,
  lastAttemptAt,
  now = Date.now(),
}) {
  const currentUrl = new URL(currentHref);
  const shouldRestore =
    currentUrl.searchParams.has(NETWORK_AUTH_QUERY_PARAM) ||
    isWithinNetworkAuthCooldown(lastAttemptAt, now);
  if (!shouldRestore) return null;

  if (storedReturnUrl) {
    try {
      const parsedReturnUrl = new URL(storedReturnUrl);
      if (parsedReturnUrl.origin === currentUrl.origin) {
        return parsedReturnUrl.toString();
      }
    } catch {}
  }

  return removeNetworkAuthParam(currentHref);
}

export function isWithinNetworkAuthCooldown(
  lastAttemptAt,
  now = Date.now(),
  cooldownMs = NETWORK_AUTH_REDIRECT_COOLDOWN_MS
) {
  const parsedAttempt = Number(lastAttemptAt);
  return (
    Number.isFinite(parsedAttempt) &&
    parsedAttempt > 0 &&
    now - parsedAttempt >= 0 &&
    now - parsedAttempt < cooldownMs
  );
}
