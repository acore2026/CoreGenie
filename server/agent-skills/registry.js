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

async function resolveActivatedSkillSnapshot(snapshot, workspace) {
  if (!snapshot?.name || !snapshot?.scope) return null;
  if (snapshot.scope === "global") {
    const skill = snapshot.id
      ? await PredefinedAgentSkill.get(snapshot.id)
      : (await PredefinedAgentSkill.all()).find(
          (candidate) => candidate.name === snapshot.name
        );
    if (!skill || skill.name !== snapshot.name) return null;
    return descriptor(skill, "global");
  }
  if (snapshot.scope !== "workspace" || !workspace?.id) return null;
  const skill = await resolveWorkspacePackage(workspace.id, snapshot.name);
  return skill?.valid ? descriptor(skill, "workspace") : null;
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

function canonicalSkillToolId(toolId) {
  return toolId === "rag.search" || toolId === "rag_search"
    ? "knowledge.search"
    : toolId;
}

function visibleSkillText(text, skill, visible = null) {
  let content = String(text || "");
  for (const declaredToolId of allowedToolIds(skill)) {
    const canonical = canonicalSkillToolId(declaredToolId);
    if (declaredToolId !== canonical)
      content = content.split(declaredToolId).join(canonical);
    if (visible && !visible.has(canonical))
      content = content.split(canonical).join("[unavailable tool]");
  }
  return content;
}

async function skillCatalogPrompt(
  agent,
  workspace,
  providedSkills = null,
  { visibleToolIds = null } = {}
) {
  const skills = providedSkills || (await availableSkills(agent, workspace));
  if (!skills.length) return "";
  const visible = visibleToolIds ? new Set(visibleToolIds) : null;
  const catalog = skills
    .map((skill) => {
      const allowedTools = [
        ...new Set(allowedToolIds(skill).map(canonicalSkillToolId)),
      ].filter((toolId) => !visible || visible.has(toolId));
      return `<skill name="${skill.name}" scope="${skill.scope}" revision="${skill.revision}" allowed-tools="${allowedTools.join(" ")}">\n${visibleSkillText(skill.description, skill, visible)}\n</skill>`;
    })
    .join("\n");
  return `<available_agent_skills>\n${catalog}\n</available_agent_skills>\nThese descriptions are only for pre-planning selection. When a Skill is relevant, call activate_skill before create_plan. Activation loads its complete instructions and file list. Never put Skill activation in a plan task.`;
}

module.exports = {
  allowedToolIds,
  availableSkills,
  descriptor,
  resolveActivatedSkillSnapshot,
  resolveAvailableSkill,
  skillCatalogPrompt,
};
