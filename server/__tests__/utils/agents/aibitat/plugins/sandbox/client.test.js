/* eslint-env jest, node */
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const client = require("../../../../../../utils/agents/aibitat/plugins/sandbox/lib");

it("accepts a fully escaped 1 MiB output and requests a capacity wait", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-client-"));
  const socketPath = path.join(root, "broker.sock");
  const tokenPath = path.join(root, "token");
  fs.writeFileSync(tokenPath, "test-token");
  const output = "\u0001".repeat(1024 * 1024);
  let request;
  const server = net.createServer((socket) => {
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk;
      if (!input.includes("\n")) return;
      request = JSON.parse(input.trim());
      socket.end(
        JSON.stringify({ ok: true, stdout: output, exitCode: 0 }) + "\n"
      );
    });
  });
  const socketSpy = jest
    .spyOn(client, "socketPath")
    .mockReturnValue(socketPath);
  const tokenSpy = jest.spyOn(client, "tokenPath").mockReturnValue(tokenPath);
  try {
    await new Promise((resolve) => server.listen(socketPath, resolve));
    const result = await client.run({
      language: "python",
      code: "print(1)",
      workspaceId: 1,
      invocationId: "test",
      timeoutSeconds: 7200,
    });
    expect(result.stdout).toBe(output);
    expect(request.queueTimeoutSeconds).toBe(120);
    expect(request.timeoutSeconds).toBe(7200);
    expect(request.invocationId).toMatch(/^[0-9a-f-]{36}$/i);
  } finally {
    socketSpy.mockRestore();
    tokenSpy.mockRestore();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
