const {
  formatResult,
} = require("../utils/agents/aibitat/plugins/sandbox/tool");

function sandboxToolResult(result, timeoutSeconds) {
  const output = formatResult(result, timeoutSeconds);
  if (result.timedOut)
    return {
      ok: false,
      code: "SANDBOX_TIMEOUT",
      summary: `Sandbox timed out after ${timeoutSeconds} seconds.`,
      data: output,
      retryable: true,
      evidenceIds: [],
      artifactIds: [],
    };
  if (Number(result.exitCode) !== 0) {
    const unavailable =
      Number(result.exitCode) === 125 &&
      /unable to find image|failed to resolve reference|cannot connect to the docker daemon|permission denied.*docker/i.test(
        `${result.stderr || ""}\n${result.stdout || ""}`
      );
    return {
      ok: false,
      code: unavailable ? "SANDBOX_UNAVAILABLE" : "PROCESS_EXIT_NONZERO",
      summary: unavailable
        ? "Sandbox runtime is unavailable."
        : `Sandbox process exited with code ${result.exitCode}.`,
      data: output,
      retryable: false,
      blocksCapability: unavailable,
      evidenceIds: [],
      artifactIds: [],
    };
  }
  return {
    ok: true,
    code: "OK",
    summary: output.slice(0, 500),
    data: output,
    retryable: false,
    evidenceIds: [],
    artifactIds: [],
  };
}

module.exports = { sandboxToolResult };
