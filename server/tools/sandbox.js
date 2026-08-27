const { z } = require("zod");
const { defineTool } = require("./descriptor");
const sandbox = require("../utils/agents/aibitat/plugins/sandbox/lib");
const {
  formatResult,
} = require("../utils/agents/aibitat/plugins/sandbox/tool");

function sandboxDescriptor(language) {
  return defineTool({
    id: language,
    name: language,
    description:
      language === "bash"
        ? "Run Bash in a disposable network-enabled container. The workspace is mounted read/write at /workspace and persists between invocations."
        : "Run Python in a disposable network-enabled container. The workspace is mounted read/write at /workspace and persists between invocations.",
    schema: z.object({
      code: z.string().min(1),
      timeout_seconds: z.number().int().min(1).max(30).default(30),
    }),
    execute: async ({ code, timeout_seconds }, context) => {
      const result = await sandbox.run({
        language,
        code,
        workspaceId: context.workspace.id,
        invocationId: context.run.id,
        timeoutSeconds: timeout_seconds,
      });
      return formatResult(result);
    },
  });
}

module.exports = {
  bash: sandboxDescriptor("bash"),
  python: sandboxDescriptor("python"),
};
