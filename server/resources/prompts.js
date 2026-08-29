const { composeSystemPrompt } = require("../utils/systemPrompt");
const { skillCatalogPrompt } = require("../agent-skills/registry");

async function composeAgentPrompt({
  agent,
  user = null,
  workspace = null,
  runtimePrompt = null,
  includeSkillCatalog = true,
  visibleToolIds = null,
}) {
  const catalog = includeSkillCatalog
    ? await skillCatalogPrompt(agent, workspace, null, { visibleToolIds })
    : "";
  const basePrompt = [
    agent?.systemPrompt ||
      "You are a helpful Agent. Complete the user's request using the available tools.",
    catalog || null,
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
