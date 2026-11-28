const {
  activeToolOptions,
  cleanExamplePrompts,
  validateAgentPayload,
} = require("./validation.ts");
const { registerPredefinedAgentCoreEndpoints } = require("./agents.ts");
const {
  registerPredefinedSkillsAndTasksEndpoints,
} = require("./skillsAndTasks.ts");

function predefinedAgentEndpoints(app: Record<string, any>): void {
  if (!app) return;
  registerPredefinedAgentCoreEndpoints(app);
  registerPredefinedSkillsAndTasksEndpoints(app);
}

module.exports = {
  activeToolOptions,
  cleanExamplePrompts,
  predefinedAgentEndpoints,
  validateAgentPayload,
};
