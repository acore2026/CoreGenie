import type {
  AdminData,
  Agent,
  Capability,
  SaveResult,
  Skill,
} from "@coregenie/contracts/predefinedAgents.mts";
import { api, errorMessage } from "@/utils/api";

export interface SkillDetailResponse {
  success?: boolean;
  skill?: Skill;
  error?: string;
}

export interface WorkspaceSkillsResponse {
  success?: boolean;
  skills?: Skill[];
  error?: string;
}

async function safeJson<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown
): Promise<T | { success: false; error: string }> {
  try {
    return await api.request<T>(path, { method, body });
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

const PredefinedAgent = {
  list: async (): Promise<{
    agents: Agent[];
    defaultAgentId: number | null;
  }> => {
    const data = await safeJson<{
      agents?: Agent[];
      defaultAgentId?: number | null;
    }>("/predefined-agents");
    if ("error" in data && !("agents" in data)) {
      return { agents: [], defaultAgentId: null };
    }
    const payload = data as {
      agents?: Agent[];
      defaultAgentId?: number | null;
    };
    return {
      agents: payload.agents || [],
      defaultAgentId: payload.defaultAgentId || null,
    };
  },

  adminList: async (): Promise<AdminData | { success: false; error: string }> =>
    safeJson<AdminData>("/admin/predefined-agents"),

  create: async (
    payload: Record<string, unknown>
  ): Promise<SaveResult<{ agent: Agent }>> =>
    safeJson<SaveResult<{ agent: Agent }>>(
      "/admin/predefined-agents",
      "POST",
      payload
    ),

  update: async (
    id: number | string,
    payload: Record<string, unknown>
  ): Promise<SaveResult<{ agent: Agent }>> =>
    safeJson<SaveResult<{ agent: Agent }>>(
      `/admin/predefined-agents/${id}`,
      "PUT",
      payload
    ),

  delete: async (id: number | string): Promise<SaveResult> =>
    safeJson<SaveResult>(`/admin/predefined-agents/${id}`, "DELETE"),

  setDefault: async (agentId: number | null): Promise<SaveResult> =>
    safeJson<SaveResult>("/admin/predefined-agents/default", "POST", {
      agentId,
    }),

  uploadIcon: async (id: number | string, icon: Blob): Promise<SaveResult> => {
    const form = new FormData();
    form.append("icon", icon);
    return safeJson<SaveResult>(
      `/admin/predefined-agents/${id}/icon`,
      "POST",
      form
    );
  },

  createQuickTask: async (
    payload: Record<string, unknown>
  ): Promise<SaveResult> =>
    safeJson<SaveResult>("/admin/predefined-quick-tasks", "POST", payload),

  updateQuickTask: async (
    id: number | string,
    payload: Record<string, unknown>
  ): Promise<SaveResult> =>
    safeJson<SaveResult>(`/admin/predefined-quick-tasks/${id}`, "PUT", payload),

  validateQuickTask: async (
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> =>
    safeJson<Record<string, unknown>>(
      "/admin/predefined-quick-tasks/validate",
      "POST",
      payload
    ),

  createSkill: async (
    payload: Record<string, unknown>
  ): Promise<SaveResult<{ skill?: Skill }>> =>
    safeJson<SaveResult<{ skill?: Skill }>>(
      "/admin/predefined-agent-skills",
      "POST",
      payload
    ),

  updateSkill: async (
    id: number | string,
    payload: Record<string, unknown>
  ): Promise<SaveResult<{ skill?: Skill }>> =>
    safeJson<SaveResult<{ skill?: Skill }>>(
      `/admin/predefined-agent-skills/${id}`,
      "PUT",
      payload
    ),

  deleteSkill: async (id: number | string): Promise<SaveResult> =>
    safeJson<SaveResult>(`/admin/predefined-agent-skills/${id}`, "DELETE"),

  getSkill: async (id: number | string): Promise<SkillDetailResponse> =>
    safeJson<SkillDetailResponse>(`/admin/predefined-agent-skills/${id}`),

  uploadSkillFile: async (
    id: number | string,
    path: string,
    file: Blob
  ): Promise<SaveResult> => {
    const form = new FormData();
    form.append("path", path);
    form.append("file", file);
    return safeJson<SaveResult>(
      `/admin/predefined-agent-skills/${id}/file`,
      "POST",
      form
    );
  },

  workspaceSkills: async (slug: string): Promise<WorkspaceSkillsResponse> =>
    safeJson<WorkspaceSkillsResponse>(`/workspace/${slug}/agent-skills`),

  getWorkspaceSkill: async (
    slug: string,
    name: string
  ): Promise<SkillDetailResponse> =>
    safeJson<SkillDetailResponse>(
      `/workspace/${slug}/agent-skills/${encodeURIComponent(name)}`
    ),

  saveWorkspaceSkill: async (
    slug: string,
    payload: Record<string, unknown>
  ): Promise<SaveResult<{ skill?: Skill }>> =>
    safeJson<SaveResult<{ skill?: Skill }>>(
      `/workspace/${slug}/agent-skills`,
      "POST",
      payload
    ),

  deleteWorkspaceSkill: async (
    slug: string,
    name: string
  ): Promise<SaveResult> =>
    safeJson<SaveResult>(
      `/workspace/${slug}/agent-skills/${encodeURIComponent(name)}`,
      "DELETE"
    ),

  uploadWorkspaceSkillFile: async (
    slug: string,
    name: string,
    path: string,
    file: Blob
  ): Promise<SaveResult> => {
    const form = new FormData();
    form.append("path", path);
    form.append("file", file);
    return safeJson<SaveResult>(
      `/workspace/${slug}/agent-skills/${encodeURIComponent(name)}/file`,
      "POST",
      form
    );
  },

  saveModelCapability: async (
    payload: Capability | Record<string, unknown>
  ): Promise<SaveResult> =>
    safeJson<SaveResult>("/admin/model-capabilities", "PUT", payload),
};

export default PredefinedAgent;
