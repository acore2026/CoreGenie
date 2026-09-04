import test from "node:test";
import assert from "node:assert/strict";
import {
  NETWORK_AUTH_QUERY_PARAM,
  NETWORK_PROBE_STATUS,
  buildNetworkAuthUrl,
  isWithinNetworkAuthCooldown,
  probeNetworkSession,
  removeNetworkAuthParam,
  resolveNetworkAuthReturnUrl,
} from "./networkAuth.js";

function headers(values = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return { get: (key) => normalized[key.toLowerCase()] || null };
}

test("accepts a signed JSON ping response", async () => {
  const result = await probeNetworkSession({
    endpoint: "/api/ping",
    now: 123,
    fetchFn: async (url, options) => {
      assert.equal(url, "/api/ping?_network_probe=123");
      assert.equal(options.redirect, "manual");
      assert.equal(options.cache, "no-store");
      return {
        ok: true,
        status: 200,
        type: "basic",
        redirected: false,
        headers: headers({
          "content-type": "application/json; charset=utf-8",
          "x-request-id": "request-1",
        }),
        json: async () => ({ online: true }),
      };
    },
  });

  assert.equal(result.status, NETWORK_PROBE_STATUS.healthy);
});

test("recognizes an opaque redirect as an access portal", async () => {
  const result = await probeNetworkSession({
    endpoint: "/api/ping",
    fetchFn: async () => ({
      ok: false,
      status: 0,
      type: "opaqueredirect",
      redirected: false,
    }),
  });

  assert.equal(result.status, NETWORK_PROBE_STATUS.portal);
});

test("recognizes a visible redirect as an access portal", async () => {
  const result = await probeNetworkSession({
    endpoint: "/api/ping",
    fetchFn: async () => ({
      ok: false,
      status: 302,
      type: "basic",
      redirected: false,
    }),
  });

  assert.equal(result.status, NETWORK_PROBE_STATUS.portal);
});

test("rejects HTML and unsigned responses", async () => {
  const htmlResult = await probeNetworkSession({
    endpoint: "/api/ping",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      type: "basic",
      redirected: false,
      headers: headers({ "content-type": "text/html" }),
    }),
  });
  const unsignedResult = await probeNetworkSession({
    endpoint: "/api/ping",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      type: "basic",
      redirected: false,
      headers: headers({ "content-type": "application/json" }),
      json: async () => ({ online: true }),
    }),
  });

  assert.equal(htmlResult.status, NETWORK_PROBE_STATUS.unavailable);
  assert.equal(unsignedResult.status, NETWORK_PROBE_STATUS.unavailable);
});

test("returns unavailable when the request fails", async () => {
  const result = await probeNetworkSession({
    endpoint: "/api/ping",
    fetchFn: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  assert.equal(result.status, NETWORK_PROBE_STATUS.unavailable);
});

test("aborts a probe that exceeds its timeout", async () => {
  const result = await probeNetworkSession({
    endpoint: "/api/ping",
    timeoutMs: 5,
    fetchFn: async (_, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      }),
  });

  assert.equal(result.status, NETWORK_PROBE_STATUS.unavailable);
});

test("adds and removes the authentication cache-buster", () => {
  const original = "https://work.example/workspace/radio?tab=files#latest";
  const redirectUrl = buildNetworkAuthUrl(original, 456);
  const parsedRedirect = new URL(redirectUrl);

  assert.equal(
    parsedRedirect.searchParams.get(NETWORK_AUTH_QUERY_PARAM),
    "456"
  );
  assert.equal(removeNetworkAuthParam(redirectUrl), original);
});

test("applies the redirect cooldown only to recent valid timestamps", () => {
  assert.equal(isWithinNetworkAuthCooldown("900", 1_000, 200), true);
  assert.equal(isWithinNetworkAuthCooldown("700", 1_000, 200), false);
  assert.equal(isWithinNetworkAuthCooldown("invalid", 1_000, 200), false);
  assert.equal(isWithinNetworkAuthCooldown("1100", 1_000, 200), false);
});

test("restores the saved route after a recent authentication attempt", () => {
  const returnUrl = resolveNetworkAuthReturnUrl({
    currentHref: "https://work.example/onboarding",
    storedReturnUrl: "https://work.example/workspace/radio?tab=files#latest",
    lastAttemptAt: "900",
    now: 1_000,
  });

  assert.equal(
    returnUrl,
    "https://work.example/workspace/radio?tab=files#latest"
  );
});

test("does not restore stale or cross-origin return routes", () => {
  assert.equal(
    resolveNetworkAuthReturnUrl({
      currentHref: "https://work.example/onboarding",
      storedReturnUrl: "https://work.example/workspace/radio",
      lastAttemptAt: "1",
      now: 200_000,
    }),
    null
  );
  assert.equal(
    resolveNetworkAuthReturnUrl({
      currentHref: "https://work.example/login?_network_auth=900",
      storedReturnUrl: "https://malicious.example/",
      lastAttemptAt: "900",
      now: 1_000,
    }),
    "https://work.example/login"
  );
});
