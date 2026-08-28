const { z } = require("zod");
const { defineTool } = require("./descriptor");
const sandbox = require("../utils/agents/aibitat/plugins/sandbox/lib");
const { sandboxToolResult } = require("./sandboxResult");
const { resolveAvailableSkill } = require("../agent-skills/registry");

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 1800;

async function resolveSkillMount(cwd, context) {
  if (cwd === "/workspace") return { skill: null, result: null };
  const match = String(cwd || "").match(/^skill:\/\/([a-z0-9-]+)$/);
  if (!match)
    return {
      skill: null,
      result: {
        ok: false,
        code: "INVALID_WORKING_DIRECTORY",
        summary: "cwd must be /workspace or skill://<activated-skill>.",
        retryable: false,
      },
    };
  const name = match[1];
  const active = context.activatedSkill(name);
  if (!active)
    return {
      skill: null,
      result: {
        ok: false,
        code: "SKILL_NOT_ACTIVATED",
        summary: `The requested root skill://${name} is not activated. Use the exact skillRoot returned by skill.activate; do not copy a different hard-coded skill:// name from the package instructions.`,
        retryable: false,
      },
    };
  const skill = await resolveAvailableSkill(
    context.agent,
    context.workspace,
    name
  );
  if (!skill)
    return {
      skill: null,
      result: {
        ok: false,
        code: "SKILL_NOT_AVAILABLE",
        summary: `${name} is no longer available.`,
        retryable: false,
      },
    };
  if (skill.revision !== active.revision) {
    context.activateSkill(skill);
    await context.emit("skill.updated", {
      name,
      scope: skill.scope,
      fromRevision: active.revision,
      revision: skill.revision,
    });
    return {
      skill: null,
      result: {
        ok: false,
        code: "SKILL_UPDATED",
        summary: `${name} changed and has been reactivated. Review its updated instructions before retrying.`,
        data: { instructions: skill.instructions, revision: skill.revision },
        retryable: true,
      },
    };
  }
  return {
    skill: {
      id: skill.id,
      name: skill.name,
      scope: skill.scope,
      revision: skill.revision,
    },
    result: null,
  };
}

function sandboxDescriptor(language) {
  return defineTool({
    id: language,
    name: language,
    description:
      language === "bash"
        ? "Run Bash in a disposable network-enabled container. Use cwd=skill://<name> to run an activated skill's bundled scripts relative to its root. The workspace persists at /workspace."
        : "Run Python in a disposable network-enabled container. Use cwd=skill://<name> to run an activated skill's bundled scripts relative to its root. The workspace persists at /workspace.",
    failureScope: "Sandbox runtime",
    schema: z.object({
      code: z.string().min(1),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_TIMEOUT_SECONDS)
        .default(DEFAULT_TIMEOUT_SECONDS),
      cwd: z.string().default("/workspace"),
    }),
    execute: async ({ code, timeout_seconds, cwd }, context) => {
      const resolved = await resolveSkillMount(cwd, context);
      if (resolved.result) return resolved.result;
      const result = await sandbox.run({
        language,
        code,
        workspaceId: context.workspace.id,
        invocationId: context.run.id,
        timeoutSeconds: timeout_seconds,
        skill: resolved.skill,
      });
      if (resolved.skill)
        await context.emit("skill.script.executed", {
          name: resolved.skill.name,
          scope: resolved.skill.scope,
          revision: resolved.skill.revision,
          language,
        });
      return sandboxToolResult(result, timeout_seconds);
    },
  });
}

module.exports = {
  bash: sandboxDescriptor("bash"),
  python: sandboxDescriptor("python"),
};
