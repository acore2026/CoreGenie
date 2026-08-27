import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const AgentSkillWhitelist = {
  APPROVAL_MODES: {
    ASK: "ask",
    ALWAYS_ALLOW: "always_allow",
  },

  getApprovalMode: async function () {
    return fetch(`${API_BASE}/agent-skills/approval-mode`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({
        success: false,
        mode: "always_allow",
        error: e.message,
      }));
  },

  setApprovalMode: async function (mode) {
    return fetch(`${API_BASE}/agent-skills/approval-mode`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ mode }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  /**
   * Add a skill to the whitelist
   * @param {string} skillName - The skill name to whitelist
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  addToWhitelist: async function (skillName) {
    return fetch(`${API_BASE}/agent-skills/whitelist/add`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ skillName }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },
};

export default AgentSkillWhitelist;
