const {
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  configureHTTPServer,
} = require("../../../utils/boot/httpServer");

describe("HTTP server configuration", () => {
  it("uses a long keep-alive timeout with a higher headers timeout", () => {
    const server = { keepAliveTimeout: 5_000, headersTimeout: 60_000 };

    expect(configureHTTPServer(server)).toBe(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });

  it("rejects a missing server", () => {
    expect(() => configureHTTPServer(null)).toThrow("No HTTP server defined");
  });
});
