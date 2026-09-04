const { EventEmitter } = require("events");
const {
  requestDiagnostics,
  resolveRequestId,
} = require("../../middleware/requestDiagnostics");

function mockResponse() {
  const response = new EventEmitter();
  const headers = new Map();
  response.locals = {};
  response.statusCode = 200;
  response.writableFinished = false;
  response.setHeader = jest.fn((name, value) =>
    headers.set(name.toLowerCase(), value)
  );
  response.hasHeader = jest.fn((name) => headers.has(name.toLowerCase()));
  response.getHeader = (name) => headers.get(name.toLowerCase());
  response.writeHead = jest.fn();
  return response;
}

describe("request diagnostics", () => {
  it("keeps a safe incoming request ID", () => {
    expect(
      resolveRequestId({ headers: { "x-request-id": "browser:request-42" } })
    ).toBe("browser:request-42");
  });

  it("replaces an unsafe incoming request ID", () => {
    expect(
      resolveRequestId({ headers: { "x-request-id": "unsafe request id" } })
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("adds request and server timing headers", () => {
    const now = jest.fn().mockReturnValueOnce(10).mockReturnValueOnce(15.25);
    const request = {
      headers: { origin: "http://localhost:5173" },
      method: "GET",
      baseUrl: "/api",
      path: "/ping",
    };
    const response = mockResponse();
    const next = jest.fn();

    requestDiagnostics({ now })(request, response, next);
    response.writeHead(200);

    expect(next).toHaveBeenCalledTimes(1);
    expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.locals.requestId).toBe(request.id);
    expect(response.getHeader("X-Request-ID")).toBe(request.id);
    expect(response.getHeader("Timing-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
    expect(response.getHeader("Server-Timing")).toBe("app;dur=5.3");
  });

  it("logs completed requests that exceed the threshold", () => {
    const now = jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(1_250.5);
    const logger = { warn: jest.fn() };
    const request = {
      headers: { "x-request-id": "slow-42" },
      method: "POST",
      baseUrl: "/api",
      path: "/workspace/demo",
    };
    const response = mockResponse();
    response.statusCode = 201;
    response.writableFinished = true;

    requestDiagnostics({ now, logger })(request, response, jest.fn());
    response.emit("finish");

    expect(logger.warn).toHaveBeenCalledWith(
      "[HTTP Slow] requestId=slow-42 method=POST path=/api/workspace/demo status=201 state=finished durationMs=1150.5"
    );
  });

  it("records a slow response that closes before finishing", () => {
    const now = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1_500);
    const logger = { warn: jest.fn() };
    const request = {
      headers: { "x-request-id": "aborted-42" },
      method: "GET",
      baseUrl: "/api",
      path: "/stream",
    };
    const response = mockResponse();

    requestDiagnostics({ now, logger })(request, response, jest.fn());
    response.emit("close");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("state=aborted durationMs=1500.0")
    );
  });

  it("measures event streams to their response headers", () => {
    const now = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1_250);
    const logger = { warn: jest.fn() };
    const request = {
      headers: { "x-request-id": "stream-42" },
      method: "GET",
      baseUrl: "/api",
      path: "/events",
    };
    const response = mockResponse();
    response.setHeader("Content-Type", "text/event-stream");

    requestDiagnostics({ now, logger })(request, response, jest.fn());
    response.writeHead(200);
    response.emit("close");

    expect(response.getHeader("Server-Timing")).toBe("app;dur=1250.0");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("state=headers durationMs=1250.0")
    );
  });
});
