/**
 * Built-in configurable agent skills that are enabled when an installation
 * has not saved an explicit default_agent_skills preference yet.
 *
 * Keep this list limited to user-facing skills from the Agent Skills settings
 * page. Internal plugins (chat history, websocket routing, etc.) are not
 * configurable skills and should not be added here.
 */
const DEFAULT_ENABLED_CONFIGURABLE_SKILLS = [
  "filesystem-agent",
  "create-files-agent",
  "create-chart",
  "web-browsing",
  "sql-agent",
  "create-scheduled-job",
  "gmail-agent",
  "google-calendar-agent",
  "outlook-agent",
  "bash",
  "python",
];

const DEFAULT_AGENT_CLARIFYING_QUESTIONS_ENABLED = "true";

module.exports = {
  DEFAULT_ENABLED_CONFIGURABLE_SKILLS,
  DEFAULT_AGENT_CLARIFYING_QUESTIONS_ENABLED,
};
