const fs = require("fs");
const fsp = require("fs/promises");
const net = require("net");
const path = require("path");

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class SandboxClient {
  socketPath() {
    return (
      process.env.SANDBOX_BROKER_SOCKET ||
      path.join(
        process.env.STORAGE_DIR ||
          path.resolve(__dirname, "../../../../../storage"),
        "sandbox",
        "run.sock"
      )
    );
  }

  tokenPath() {
    return (
      process.env.SANDBOX_BROKER_TOKEN_FILE ||
      path.join(
        process.env.STORAGE_DIR ||
          path.resolve(__dirname, "../../../../../storage"),
        "sandbox",
        "token"
      )
    );
  }

  isToolAvailable() {
    if (process.env.NODE_ENV === "test") return true;
    return fs.existsSync(this.socketPath()) && fs.existsSync(this.tokenPath());
  }

  async run({
    language,
    code,
    workspaceId,
    invocationId,
    timeoutSeconds,
    skill = null,
  }) {
    const token = (await fsp.readFile(this.tokenPath(), "utf8")).trim();
    if (!token) throw new Error("Sandbox broker token is empty");

    const payload = JSON.stringify({
      token,
      language,
      code,
      workspaceId,
      invocationId,
      timeoutSeconds,
      skill,
    });

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: this.socketPath() });
      let response = "";
      let settled = false;
      const clientTimeoutMs = (Number(timeoutSeconds) + 15) * 1_000;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        callback(value);
      };

      socket.setTimeout(clientTimeoutMs);
      socket.on("connect", () => socket.write(`${payload}\n`));
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8");
        if (Buffer.byteLength(response, "utf8") > MAX_RESPONSE_BYTES) {
          finish(
            reject,
            new Error("Sandbox broker response exceeded its limit")
          );
          return;
        }

        const newline = response.indexOf("\n");
        if (newline === -1) return;
        try {
          const result = JSON.parse(response.slice(0, newline));
          if (!result?.ok) {
            const error = new Error(
              result?.error || "Sandbox execution failed"
            );
            if (typeof result?.code === "string") error.code = result.code;
            if (typeof result?.retryable === "boolean")
              error.retryable = result.retryable;
            return finish(reject, error);
          }
          finish(resolve, result);
        } catch {
          finish(reject, new Error("Sandbox broker returned invalid JSON"));
        }
      });
      socket.on("timeout", () =>
        finish(reject, new Error("Sandbox broker request timed out"))
      );
      socket.on("error", (error) => finish(reject, error));
      socket.on("end", () => {
        if (!settled)
          finish(reject, new Error("Sandbox broker closed without a response"));
      });
    });
  }
}

module.exports = new SandboxClient();
