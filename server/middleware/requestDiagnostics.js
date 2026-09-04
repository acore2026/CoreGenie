const { randomUUID } = require("crypto");

const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function resolveRequestId(request) {
  const provided = request.headers?.["x-request-id"];
  return typeof provided === "string" && REQUEST_ID_PATTERN.test(provided)
    ? provided
    : randomUUID();
}

function requestDiagnostics({
  slowRequestThresholdMs = DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
  now = () => Number(process.hrtime.bigint()) / 1_000_000,
  logger = console,
} = {}) {
  return function requestDiagnosticsMiddleware(request, response, next) {
    const startedAt = now();
    const requestId = resolveRequestId(request);
    let logged = false;

    request.id = requestId;
    response.locals = response.locals || {};
    response.locals.requestId = requestId;
    response.setHeader("X-Request-ID", requestId);
    if (request.headers?.origin) {
      response.setHeader("Timing-Allow-Origin", request.headers.origin);
    }

    function isEventStream() {
      return /^text\/event-stream\b/i.test(
        String(response.getHeader("Content-Type") || "")
      );
    }

    function logSlowRequest(state, measuredDurationMs = null) {
      if (logged) return;
      const durationMs = measuredDurationMs ?? Math.max(0, now() - startedAt);
      if (durationMs < slowRequestThresholdMs) return;

      logged = true;
      const path = `${request.baseUrl || ""}${request.path || ""}` || "/";
      logger.warn(
        `[HTTP Slow] requestId=${requestId} method=${request.method} path=${path} status=${response.statusCode} state=${state} durationMs=${durationMs.toFixed(1)}`
      );
    }

    const originalWriteHead = response.writeHead;
    response.writeHead = function writeHeadWithServerTiming(...args) {
      const durationMs = Math.max(0, now() - startedAt);
      if (!response.hasHeader("Server-Timing")) {
        response.setHeader("Server-Timing", `app;dur=${durationMs.toFixed(1)}`);
      }
      if (isEventStream()) logSlowRequest("headers", durationMs);
      return originalWriteHead.apply(this, args);
    };

    response.once("finish", () => {
      if (!isEventStream()) logSlowRequest("finished");
    });
    response.once("close", () => {
      if (!response.writableFinished && !isEventStream()) {
        logSlowRequest("aborted");
      }
    });
    next();
  };
}

module.exports = {
  DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
  REQUEST_ID_PATTERN,
  requestDiagnostics,
  resolveRequestId,
};
