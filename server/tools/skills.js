const { z } = require("zod");
const path = require("path");
const { defineTool } = require("./descriptor");
const { resolveAvailableSkill } = require("../agent-skills/registry");
const { readPackageResource } = require("../agent-skills/package");

async function currentSkill(name, context) {
  return resolveAvailableSkill(context.agent, context.workspace, name);
}

function runtimeInstructions(skill) {
  const skillRoot = `skill://${skill.name}`;
  return `Runtime environment note: this activated package's exact skill root is \`${skillRoot}\`. Always pass \`cwd=${skillRoot}\` when running its bundled scripts. If the package instructions contain a different hard-coded \`skill://...\` example from an earlier package name, ignore that example and use \`${skillRoot}\` instead. When calling \`read_skill_resource\`, copy the exact resource path (including its directory and extension) from the activated package's \`files\` list; do not guess alternate paths.\n\n${skill.instructions}`;
}

function readableResourcePaths(skill) {
  return (skill.files || []).map((file) => file.path).filter(Boolean);
}

function normalizedRequestedPath(requestedPath) {
  const raw = String(requestedPath || "")
    .replace(/\\/g, "/")
    .trim();
  if (
    !raw ||
    raw.includes("\0") ||
    raw.startsWith("/") ||
    /^[A-Za-z]:/.test(raw)
  )
    return null;
  const normalized = path.posix.normalize(raw);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  )
    return null;
  return normalized;
}

function basenameStem(filePath) {
  const basename = path.posix.basename(filePath).toLocaleLowerCase("en-US");
  const extension = path.posix.extname(basename);
  return extension ? basename.slice(0, -extension.length) : basename;
}

function resolveResourcePath(skill, requestedPath) {
  const availablePaths = readableResourcePaths(skill);
  const normalized = normalizedRequestedPath(requestedPath);
  if (!normalized) return { path: null, availablePaths, suggestions: [] };

  const exact = availablePaths.find((filePath) => filePath === normalized);
  if (exact)
    return {
      path: exact,
      availablePaths,
      suggestions: [exact],
      aliased: false,
    };

  const requestedLower = normalized.toLocaleLowerCase("en-US");
  const requestedBasename = path.posix.basename(requestedLower);
  const requestedStem = basenameStem(requestedLower);
  const matches = availablePaths.filter((filePath) => {
    const candidateLower = filePath.toLocaleLowerCase("en-US");
    return (
      candidateLower === requestedLower ||
      path.posix.basename(candidateLower) === requestedBasename ||
      basenameStem(candidateLower) === requestedStem
    );
  });
  return {
    path: matches.length === 1 ? matches[0] : null,
    availablePaths,
    suggestions: matches,
    aliased: matches.length === 1,
  };
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
    "Read a resource from an activated Agent Skill. Use the exact packaged path, including its directory and extension, from the files list returned by activate_skill. Never guess path variants. Large resources are returned in chunks.",
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
    const resolved = resolveResourcePath(skill, path);
    if (!resolved.path)
      return {
        ok: false,
        code: "SKILL_RESOURCE_NOT_FOUND",
        summary: `"${path}" is not a packaged resource in ${name}. Do not guess another path; use one of the exact available paths.`,
        data: {
          requestedPath: path,
          suggestions: resolved.suggestions,
          availablePaths: resolved.availablePaths,
        },
        retryable: false,
      };
    const resource = await readPackageResource(
      skill.root,
      resolved.path,
      offset
    );
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
        : resolved.aliased
          ? `Read ${resource.path} (resolved from ${path}).`
          : `Read ${resource.path}.`,
      data: resource,
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

module.exports = {
  activateSkill,
  readSkillResource,
  runtimeInstructions,
  resolveResourcePath,
};
