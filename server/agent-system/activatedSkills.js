const { resolveActivatedSkillSnapshot } = require("../agent-skills/registry");
const { runtimeInstructions } = require("../tools/skills");

function activatedSkillSnapshot(skill = {}) {
  return {
    id: skill.id ?? null,
    key: skill.key || `${skill.scope || "global"}:${skill.name}`,
    name: skill.name,
    scope: skill.scope || "global",
    revision: skill.revision || null,
    skillRoot: `skill://${skill.name}`,
    description: skill.description || "",
    allowedTools: skill.allowedTools || "",
    instructions: skill.instructions || "",
    files: (skill.files || []).map(({ path, size, text }) => ({
      path,
      size,
      text,
    })),
  };
}

function mergeActivatedSkills(current = [], updates = []) {
  const merged = new Map(current.map((skill) => [skill.name, skill]));
  for (const skill of updates || []) {
    if (skill?.name) merged.set(skill.name, skill);
  }
  return [...merged.values()];
}

function activatedSkillsPrompt(skills = [], visibleToolIds = null) {
  if (!skills.length) return "";
  const blocks = skills.map((skill) => {
    const files = (skill.files || []).map((file) => file.path).filter(Boolean);
    return `<activated_agent_skill name="${skill.name}" scope="${skill.scope}" revision="${skill.revision || "unknown"}" root="${skill.skillRoot || `skill://${skill.name}`}">
${runtimeInstructions(skill, visibleToolIds)}

Packaged files:
${files.length ? files.map((file) => `- ${file}`).join("\n") : "- none"}
</activated_agent_skill>`;
  });
  return `<activated_agent_skills>
${blocks.join("\n")}
</activated_agent_skills>
These Skills were activated before planning. Follow their instructions, but do not activate them again.`;
}

function skillRevisionChangedError(skill) {
  const error = new Error(
    `Skill "${skill.name}" changed after it was activated. Start a new run so planning and execution use the same revision.`
  );
  error.code = "ACTIVATED_SKILL_REVISION_CHANGED";
  error.retryable = false;
  return error;
}

async function restoreActivatedSkills(skills = [], workspace, target) {
  const scope =
    target instanceof Map
      ? target
      : target.activatedSkills || (target.activatedSkills = new Map());
  const restored = [];
  for (const snapshot of skills || []) {
    const current = await resolveActivatedSkillSnapshot(snapshot, workspace);
    if (!current || current.revision !== snapshot.revision)
      throw skillRevisionChangedError(snapshot);
    scope.set(current.name, current);
    restored.push(current);
  }
  return restored;
}

module.exports = {
  activatedSkillSnapshot,
  activatedSkillsPrompt,
  mergeActivatedSkills,
  restoreActivatedSkills,
  skillRevisionChangedError,
};
