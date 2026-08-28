const GLOBAL_SYSTEM_PROMPT_LABEL = "global_system_prompt";
const {
  loadWorkspaceAgentInstructions,
} = require("./workspaceAgentInstructions");

function promptText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Build the single system message used by normal chats and Agents.
 * Global instructions have the highest precedence, followed by the selected
 * Agent/base prompt, workspace agent.md, then the signed-in user's personal
 * instructions.
 */
async function composeSystemPrompt({
  basePrompt,
  user = null,
  workspace = null,
}) {
  // Load lazily because SystemSettings resolves provider helpers during boot,
  // while providers also call this composer.
  const { SystemSettings } = require("../models/systemSettings");
  const { SystemPromptVariables } = require("../models/systemPromptVariables");
  const globalPrompt = promptText(
    await SystemSettings.getValueOrFallback(
      { label: GLOBAL_SYSTEM_PROMPT_LABEL },
      ""
    )
  );
  const agentPrompt = promptText(basePrompt);
  const workspacePrompt = promptText(
    await loadWorkspaceAgentInstructions(workspace)
  );
  const userPrompt = promptText(user?.systemPrompt);

  let combinedPrompt = agentPrompt;
  if (globalPrompt || workspacePrompt || userPrompt) {
    const sections = [
      globalPrompt
        ? `<global_system_prompt>\n${globalPrompt}\n</global_system_prompt>`
        : null,
      agentPrompt
        ? `<agent_system_prompt>\n${agentPrompt}\n</agent_system_prompt>`
        : null,
      workspacePrompt
        ? `<workspace_agent_md>\n${workspacePrompt}\n</workspace_agent_md>`
        : null,
      userPrompt
        ? `<user_system_prompt>\n${userPrompt}\n</user_system_prompt>`
        : null,
    ].filter(Boolean);

    combinedPrompt = [
      "Follow all instruction sections below. If instructions conflict, precedence is global, then Agent, then workspace agent.md, then user.",
      ...sections,
    ].join("\n\n");
  }

  return SystemPromptVariables.expandSystemPromptVariables(
    combinedPrompt,
    user?.id ?? null,
    workspace?.id ?? null
  );
}

module.exports = {
  GLOBAL_SYSTEM_PROMPT_LABEL,
  composeSystemPrompt,
};
