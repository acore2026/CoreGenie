const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

const AgentSkillWhitelist = {
  SINGLE_USER_LABEL: "whitelisted_agent_skills",
  GLOBAL_APPROVAL_MODE_LABEL: "agent_tool_approval_mode",
  APPROVAL_MODES: {
    ASK: "ask",
    ALWAYS_ALLOW: "always_allow",
  },

  /**
   * Get the global tool approval mode.
   * @returns {Promise<"ask"|"always_allow">}
   */
  getApprovalMode: async function () {
    try {
      const setting = await prisma.system_settings.findFirst({
        where: { label: this.GLOBAL_APPROVAL_MODE_LABEL },
      });
      return Object.values(this.APPROVAL_MODES).includes(setting?.value)
        ? setting.value
        : this.APPROVAL_MODES.ALWAYS_ALLOW;
    } catch (error) {
      console.error(
        "AgentSkillWhitelist.getApprovalMode error:",
        error.message
      );
      return this.APPROVAL_MODES.ALWAYS_ALLOW;
    }
  },

  /**
   * Change the global tool approval mode.
   * @param {"ask"|"always_allow"} mode
   * @returns {Promise<{success: boolean, mode?: string, error: string|null}>}
   */
  setApprovalMode: async function (mode) {
    try {
      if (!Object.values(this.APPROVAL_MODES).includes(mode)) {
        return { success: false, error: "Invalid tool approval mode" };
      }
      await prisma.system_settings.upsert({
        where: { label: this.GLOBAL_APPROVAL_MODE_LABEL },
        update: { value: mode },
        create: { label: this.GLOBAL_APPROVAL_MODE_LABEL, value: mode },
      });
      return { success: true, mode, error: null };
    } catch (error) {
      console.error(
        "AgentSkillWhitelist.setApprovalMode error:",
        error.message
      );
      return { success: false, error: error.message };
    }
  },

  /** @returns {Promise<boolean>} */
  isGlobalAlwaysAllow: async function () {
    return (await this.getApprovalMode()) === this.APPROVAL_MODES.ALWAYS_ALLOW;
  },

  /**
   * Get the label for storing whitelist in system_settings
   * @param {number|null} userId - User ID in multi-user mode, null for single-user
   * @returns {string}
   */
  _getLabel: function (userId = null) {
    if (userId) return `user_${userId}_whitelisted_agent_skills`;
    return this.SINGLE_USER_LABEL;
  },

  /**
   * Get the whitelisted skills for a user or the system
   * @param {number|null} userId - User ID in multi-user mode, null for single-user
   * @returns {Promise<string[]>} Array of whitelisted skill names
   */
  get: async function (userId = null) {
    try {
      const label = this._getLabel(userId);
      const setting = await prisma.system_settings.findFirst({
        where: { label },
      });
      return safeJsonParse(setting?.value, []);
    } catch (error) {
      console.error("AgentSkillWhitelist.get error:", error.message);
      return [];
    }
  },

  /**
   * Add a skill to the whitelist
   * @param {string} skillName - The skill name to whitelist
   * @param {number|null} userId - User ID in multi-user mode, null for single-user
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  add: async function (skillName, userId = null) {
    try {
      if (!skillName || typeof skillName !== "string") {
        return { success: false, error: "Invalid skill name" };
      }

      const label = this._getLabel(userId);
      const currentList = await this.get(userId);

      if (currentList.includes(skillName)) {
        return { success: true, error: null };
      }

      const newList = [...currentList, skillName];

      await prisma.system_settings.upsert({
        where: { label },
        update: { value: JSON.stringify(newList) },
        create: { label, value: JSON.stringify(newList) },
      });

      return { success: true, error: null };
    } catch (error) {
      console.error("AgentSkillWhitelist.add error:", error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Check if a skill is whitelisted
   * @param {string} skillName - The skill name to check
   * @param {number|null} userId - User ID in multi-user mode, null for single-user
   * @returns {Promise<boolean>}
   */
  isWhitelisted: async function (skillName, userId = null) {
    const whitelist = await this.get(userId);
    return whitelist.includes(skillName);
  },

  /**
   * Clear the single-user whitelist (used when switching to multi-user mode)
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  clearSingleUserWhitelist: async function () {
    try {
      await prisma.system_settings.deleteMany({
        where: { label: this.SINGLE_USER_LABEL },
      });
      return { success: true, error: null };
    } catch (error) {
      console.error(
        "AgentSkillWhitelist.clearSingleUserWhitelist error:",
        error.message
      );
      return { success: false, error: error.message };
    }
  },
};

module.exports = { AgentSkillWhitelist };
