const sandbox = require("./lib");

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 1800;

function formatResult(result, timeoutSeconds = null) {
  const sections = [`Exit code: ${result.exitCode}`];
  if (result.timedOut) {
    sections.push(
      timeoutSeconds
        ? `Timed out after ${timeoutSeconds} seconds.`
        : "Timed out before completion."
    );
  }
  if (result.stdout) sections.push(`stdout:\n${result.stdout}`);
  if (result.stderr) sections.push(`stderr:\n${result.stderr}`);
  if (!result.stdout && !result.stderr)
    sections.push("The command completed without output.");
  if (result.truncated)
    sections.push("[Output truncated at the sandbox output limit]");
  return sections.join("\n\n");
}

function sandboxTool(language) {
  return {
    name: language,
    startupConfig: { params: {} },
    plugin: function () {
      return {
        name: this.name,
        setup(aibitat) {
          aibitat.function({
            super: aibitat,
            name: this.name,
            description:
              language === "bash"
                ? "Run Bash code in a disposable container with outbound network access. The current AnythingLLM workspace is mounted read/write at /workspace and persists after execution. Use relative paths from /workspace. Common tools are preinstalled, including curl, wget, git, jq, yq, rg, fd, find, grep, sed, awk, sqlite3, rsync, SSH, network diagnostics, archive utilities, shellcheck, and a native build toolchain. Execution follows the configured global and per-tool approval policy."
                : "Run Python code in a disposable container with outbound network access. The current AnythingLLM workspace is mounted read/write at /workspace and persists after execution. Use relative paths from /workspace. Common packages are preinstalled, including requests, PyYAML, HTTPX, aiohttp, Beautiful Soup, lxml, NumPy, pandas, openpyxl, XlsxWriter, Pillow, pypdf, python-docx, pydantic, SQLAlchemy, jsonschema, tenacity, tqdm, and pytest. Additional pip installs persist under /workspace/.python. Execution follows the configured global and per-tool approval policy.",
            examples: [
              {
                prompt:
                  language === "bash"
                    ? "List the workspace files"
                    : "Create a JSON file in the workspace",
                call: JSON.stringify({
                  code:
                    language === "bash"
                      ? "find . -maxdepth 2 -type f -print"
                      : 'import json\nwith open("result.json", "w") as f:\n    json.dump({"ok": True}, f)',
                  timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
                }),
              },
            ],
            parameters: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: {
                code: {
                  type: "string",
                  description: `${language === "bash" ? "Bash" : "Python"} source code to execute.`,
                },
                timeout_seconds: {
                  type: "integer",
                  minimum: 1,
                  maximum: MAX_TIMEOUT_SECONDS,
                  default: DEFAULT_TIMEOUT_SECONDS,
                  description:
                    "Execution timeout in seconds (default 300, maximum 1800).",
                },
              },
              required: ["code"],
              additionalProperties: false,
            },
            handler: async function ({
              code = "",
              timeout_seconds = DEFAULT_TIMEOUT_SECONDS,
            }) {
              try {
                const invocation = this.super.handlerProps?.invocation;
                if (!invocation?.workspace_id || !invocation?.uuid)
                  return "Sandbox unavailable: authenticated workspace invocation is missing.";

                const requestApproval = this.super.requestToolApproval;
                if (!requestApproval?.isInteractive)
                  return "Sandbox execution requires interactive user approval and is unavailable in this context.";

                const timeoutSeconds = Math.max(
                  1,
                  Math.min(
                    Number(timeout_seconds) || MAX_TIMEOUT_SECONDS,
                    MAX_TIMEOUT_SECONDS
                  )
                );
                this.super.handlerProps.log(
                  `Requesting ${language} sandbox execution.`
                );
                this.super.introspect(
                  `${this.caller}: Waiting for approval to run ${language} code`
                );

                const approval = await requestApproval({
                  skillName: language,
                  payload: { code, timeout_seconds: timeoutSeconds },
                  description: `Run ${language} code in the workspace sandbox`,
                });
                if (!approval.approved) return approval.message;

                this.super.introspect(
                  `${this.caller}: Running approved ${language} code in a disposable sandbox`
                );
                const result = await sandbox.run({
                  language,
                  code,
                  workspaceId: invocation.workspace_id,
                  invocationId: invocation.uuid,
                  timeoutSeconds,
                });
                this.super.introspect(
                  `${this.caller}: ${language} sandbox exited with code ${result.exitCode}`
                );
                return formatResult(result, timeoutSeconds);
              } catch (error) {
                this.super.handlerProps.log(
                  `${language} sandbox error: ${error.message}`
                );
                this.super.introspect(`Sandbox error: ${error.message}`);
                return `Sandbox error: ${error.message}`;
              }
            },
          });
        },
      };
    },
  };
}

module.exports = { sandboxTool, formatResult };
