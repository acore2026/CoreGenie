const { composeSystemPrompt } = require("../utils/systemPrompt");

async function composeAgentPrompt({
  agent,
  user = null,
  workspace = null,
  runtimePrompt = null,
}) {
  const skills = Array.isArray(agent?.skills) ? agent.skills : [];
  const skillPrompt = skills
    .map(
      (skill) =>
        `<skill id="${skill.id}" name="${skill.name}">\n${skill.instructions}\n</skill>`
    )
    .join("\n\n");
  const basePrompt = [
    agent?.systemPrompt ||
      "You are a helpful Agent. Complete the user's request using the available tools.",
    skillPrompt ? `<agent_skills>\n${skillPrompt}\n</agent_skills>` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const composed = await composeSystemPrompt({ basePrompt, user, workspace });
  return [
    composed,
    runtimePrompt
      ? `<request_system_prompt>\n${runtimePrompt}\n</request_system_prompt>`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

module.exports = { composeAgentPrompt };
