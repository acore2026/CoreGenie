/* eslint-env jest, node */
const { sandboxToolResult } = require("../../tools/sandboxResult");

describe("governed sandbox result classification", () => {
  it("treats a missing sandbox image as capability failure", () => {
    expect(
      sandboxToolResult(
        {
          exitCode: 125,
          stdout: "",
          stderr:
            "Unable to find image 'anythingllm-sandbox:local' locally; failed to resolve reference",
          timedOut: false,
          truncated: false,
        },
        30
      )
    ).toMatchObject({
      ok: false,
      code: "SANDBOX_UNAVAILABLE",
      retryable: false,
      blocksCapability: true,
    });
  });

  it("does not report timeout or non-zero exit as success", () => {
    expect(
      sandboxToolResult(
        {
          exitCode: -9,
          stdout: "partial",
          stderr: "",
          timedOut: true,
          truncated: false,
        },
        30
      )
    ).toMatchObject({ ok: false, code: "SANDBOX_TIMEOUT" });
    expect(
      sandboxToolResult(
        {
          exitCode: 2,
          stdout: "",
          stderr: "bad arguments",
          timedOut: false,
          truncated: false,
        },
        30
      )
    ).toMatchObject({ ok: false, code: "PROCESS_EXIT_NONZERO" });
  });

  it("keeps a zero exit as a successful result", () => {
    expect(
      sandboxToolResult(
        {
          exitCode: 0,
          stdout: "done",
          stderr: "",
          timedOut: false,
          truncated: false,
        },
        30
      )
    ).toMatchObject({ ok: true, code: "OK" });
  });
});
