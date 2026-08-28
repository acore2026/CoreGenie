const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { resolveAvailableSkill } = require("../agent-skills/registry");
const { readPackageResource } = require("../agent-skills/package");

async function currentSkill(name, context) {
  return resolveAvailableSkill(context.agent, context.workspace, name);
}

function runtimeInstructions(skill) {
  const skillRoot = `skill://${skill.name}`;
  return `Runtime environment note: this activated package's exact skill root is \`${skillRoot}\`. Always pass \`cwd=${skillRoot}\` when running its bundled scripts. If the package instructions contain a different hard-coded \`skill://...\` example from an earlier package name, ignore that example and use \`${skillRoot}\` instead.\n\n${skill.instructions}`;
}

const activateSkill = defineTool({
  id: "skill.activate",
  name: "activate_skill",
  description:
    "Load the complete instructions and file list for an available Agent Skill before using it.",
  action: false,
  effect: "read",
  idempotency: "safe",
  schema: z.object({
    name: z.string().trim().min(1).max(64),
  }),
  activity: ({ name }) => `Activating ${name}`,
  execute: async ({ name }, context) => {
    const skill = await currentSkill(name, context);
    if (!skill)
      return {
        ok: false,
        code: "SKILL_NOT_AVAILABLE",
        summary: `Skill "${name}" is not available to this Agent.`,
        retryable: false,
      };
    context.activateSkill(skill);
    await context.emit("skill.activated", {
      name: skill.name,
      scope: skill.scope,
      revision: skill.revision,
    });
    return {
      ok: true,
      code: "SKILL_ACTIVATED",
      summary: `Activated ${skill.name}.`,
      data: {
        name: skill.name,
        scope: skill.scope,
        revision: skill.revision,
        skillRoot: `skill://${skill.name}`,
        instructions: runtimeInstructions(skill),
        files: skill.files.map(({ path, size, text }) => ({
          path,
          size,
          text,
        })),
      },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

const readSkillResource = defineTool({
  id: "skill.read_resource",
  name: "read_skill_resource",
  description:
    "Read a text resource from an activated Agent Skill. Large resources are returned in chunks.",
  action: false,
  effect: "read",
  idempotency: "safe",
  schema: z.object({
    name: z.string().trim().min(1).max(64),
    path: z.string().trim().min(1).max(1000),
    offset: z.number().int().min(0).default(0),
  }),
  activity: ({ name, path }) => `Reading ${name}/${path}`,
  execute: async ({ name, path, offset }, context) => {
    const active = context.activatedSkill(name);
    if (!active)
      return {
        ok: false,
        code: "SKILL_NOT_ACTIVATED",
        summary: `Activate ${name} before reading its resources.`,
        retryable: false,
      };
    const skill = await currentSkill(name, context);
    if (!skill)
      return {
        ok: false,
        code: "SKILL_NOT_AVAILABLE",
        summary: `${name} is no longer available.`,
        retryable: false,
      };
    if (active.revision !== skill.revision) {
      context.activateSkill(skill);
      await context.emit("skill.updated", {
        name: skill.name,
        scope: skill.scope,
        fromRevision: active.revision,
        revision: skill.revision,
      });
      return {
        ok: false,
        code: "SKILL_UPDATED",
        summary: `${name} changed and has been reactivated. Review its updated instructions before retrying.`,
        data: {
          skillRoot: `skill://${skill.name}`,
          instructions: runtimeInstructions(skill),
          revision: skill.revision,
        },
        retryable: true,
      };
    }
    const resource = await readPackageResource(skill.root, path, offset);
    await context.emit("skill.resource.used", {
      name: skill.name,
      scope: skill.scope,
      revision: skill.revision,
      path: resource.path,
    });
    return {
      ok: true,
      code: "SKILL_RESOURCE_READ",
      summary: resource.binary
        ? `${resource.path} is a binary skill resource available to scripts.`
        : `Read ${resource.path}.`,
      data: resource,
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

module.exports = { activateSkill, readSkillResource, runtimeInstructions };
