const { PredefinedAgentSkill } = require("../models/predefinedAgentSkill");
const { listWorkspacePackages, resolveWorkspacePackage } = require("./package");

function descriptor(skill, scope) {
  return {
    id: scope === "global" ? Number(skill.id) : null,
    key: `${scope}:${skill.manifest.name}`,
    scope,
    name: skill.manifest.name,
    description: skill.manifest.description,
    compatibility: skill.manifest.compatibility || null,
    license: skill.manifest.license || null,
    metadata: skill.manifest.metadata || {},
    allowedTools: skill.manifest.allowedTools || "",
    revision: skill.sha256 || skill.revision,
    valid: skill.valid,
    warnings: skill.warnings || [],
    errors: skill.errors || [],
    files: skill.files || [],
    instructions: skill.body ?? skill.instructions,
    skillMd: skill.source ?? skill.skillMd,
    root: skill.root,
  };
}

async function availableSkills(
  agent,
  workspace,
  { includeInvalid = false } = {}
) {
  const globalSkills = await PredefinedAgentSkill.whereIds(
    agent?.skillIds || []
  );
  const globals = globalSkills.map((skill) => descriptor(skill, "global"));
  const globalNames = new Set(globals.map((skill) => skill.name));
  const workspacePackages = workspace?.id
    ? await listWorkspacePackages(workspace.id)
    : [];
  const workspaceSkills = workspacePackages.map((skill) => {
    const value = descriptor(skill, "workspace");
    if (globalNames.has(value.name)) {
      value.valid = false;
      value.errors = [
        ...value.errors,
        `Workspace skill conflicts with global skill "${value.name}".`,
      ];
    }
    return value;
  });
  const values = [...globals, ...workspaceSkills];
  return includeInvalid ? values : values.filter((skill) => skill.valid);
}

async function resolveAvailableSkill(agent, workspace, name) {
  const normalized = String(name || "").trim();
  const assigned = await PredefinedAgentSkill.whereIds(agent?.skillIds || []);
  const global = assigned.find((skill) => skill.name === normalized);
  if (global) return descriptor(global, "global");
  const allGlobals = await PredefinedAgentSkill.all();
  if (allGlobals.some((skill) => skill.name === normalized)) return null;
  if (!workspace?.id) return null;
  const workspaceSkill = await resolveWorkspacePackage(
    workspace.id,
    normalized
  );
  return workspaceSkill?.valid ? descriptor(workspaceSkill, "workspace") : null;
}

function allowedToolIds(skill) {
  return [
    ...new Set(
      String(skill?.allowedTools || "")
        .split(/\s+/)
        .map((toolId) => toolId.trim())
        .filter(Boolean)
    ),
  ];
}

async function skillCatalogPrompt(agent, workspace, providedSkills = null) {
  const skills = providedSkills || (await availableSkills(agent, workspace));
  if (!skills.length) return "";
  const catalog = skills
    .map(
      (skill) =>
        `<skill name="${skill.name}" scope="${skill.scope}" revision="${skill.revision}" allowed-tools="${allowedToolIds(skill).join(" ")}">\n${skill.description}\n</skill>`
    )
    .join("\n");
  return `<available_agent_skills>\n${catalog}\n</available_agent_skills>\nUse activate_skill before following a skill. Skill scripts and resources are relative to the activated skill root.`;
}

module.exports = {
  allowedToolIds,
  availableSkills,
  descriptor,
  resolveAvailableSkill,
  skillCatalogPrompt,
};
