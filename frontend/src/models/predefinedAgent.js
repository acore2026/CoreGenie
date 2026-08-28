import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function jsonRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...baseHeaders(), ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const PredefinedAgent = {
  list: async () => {
    const data = await jsonRequest(`${API_BASE}/predefined-agents`);
    return {
      agents: data.agents || [],
      defaultAgentId: data.defaultAgentId || null,
    };
  },
  adminList: async () => jsonRequest(`${API_BASE}/admin/predefined-agents`),
  create: async (payload) =>
    jsonRequest(`${API_BASE}/admin/predefined-agents`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: async (id, payload) =>
    jsonRequest(`${API_BASE}/admin/predefined-agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  delete: async (id) =>
    jsonRequest(`${API_BASE}/admin/predefined-agents/${id}`, {
      method: "DELETE",
    }),
  setDefault: async (agentId) =>
    jsonRequest(`${API_BASE}/admin/predefined-agents/default`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  uploadIcon: async (id, icon) => {
    const form = new FormData();
    form.append("icon", icon);
    return jsonRequest(`${API_BASE}/admin/predefined-agents/${id}/icon`, {
      method: "POST",
      body: form,
    });
  },
  createSkill: async (payload) =>
    jsonRequest(`${API_BASE}/admin/predefined-agent-skills`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSkill: async (id, payload) =>
    jsonRequest(`${API_BASE}/admin/predefined-agent-skills/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteSkill: async (id) =>
    jsonRequest(`${API_BASE}/admin/predefined-agent-skills/${id}`, {
      method: "DELETE",
    }),
  getSkill: async (id) =>
    jsonRequest(`${API_BASE}/admin/predefined-agent-skills/${id}`),
  uploadSkillFile: async (id, path, file) => {
    const form = new FormData();
    form.append("path", path);
    form.append("file", file);
    return jsonRequest(`${API_BASE}/admin/predefined-agent-skills/${id}/file`, {
      method: "POST",
      body: form,
    });
  },
  workspaceSkills: async (slug) =>
    jsonRequest(`${API_BASE}/workspace/${slug}/agent-skills`),
  getWorkspaceSkill: async (slug, name) =>
    jsonRequest(
      `${API_BASE}/workspace/${slug}/agent-skills/${encodeURIComponent(name)}`
    ),
  saveWorkspaceSkill: async (slug, payload) =>
    jsonRequest(`${API_BASE}/workspace/${slug}/agent-skills`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteWorkspaceSkill: async (slug, name) =>
    jsonRequest(
      `${API_BASE}/workspace/${slug}/agent-skills/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    ),
  uploadWorkspaceSkillFile: async (slug, name, path, file) => {
    const form = new FormData();
    form.append("path", path);
    form.append("file", file);
    return jsonRequest(
      `${API_BASE}/workspace/${slug}/agent-skills/${encodeURIComponent(name)}/file`,
      { method: "POST", body: form }
    );
  },
  saveModelCapability: async (payload) =>
    jsonRequest(`${API_BASE}/admin/model-capabilities`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
};

export default PredefinedAgent;
