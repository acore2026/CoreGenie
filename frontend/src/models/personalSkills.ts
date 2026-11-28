import type { SaveResult } from "@coregenie/contracts/api.mts";
import type { Skill } from "@coregenie/contracts/predefinedAgents.mts";
import { api, errorMessage } from "@/utils/api";

export interface SkillDetailResult {
  success?: boolean;
  skill?: Skill;
  error?: string | null;
}

export interface SkillListResult {
  template?: string;
  success?: boolean;
  skills?: Skill[];
  error?: string | null;
}

async function safeRequest<T>(
  path = "",
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown
): Promise<T | { success: false; error: string | null }> {
  try {
    return await api.request<T>(`/personal-skills${path}`, { method, body });
  } catch (error) {
    return { success: false, error: errorMessage(error, "") || null };
  }
}

const PersonalSkills = {
  list: (view: string): Promise<SkillListResult> =>
    safeRequest<SkillListResult>(`?view=${view}`),
  get: (id: number | string): Promise<SkillDetailResult> =>
    safeRequest<SkillDetailResult>(`/${id}`),
  create: (
    body: Record<string, unknown>
  ): Promise<SaveResult<{ skill?: Skill }>> =>
    safeRequest<SaveResult<{ skill?: Skill }>>("", "POST", body),
  update: (
    id: number | string,
    body: Record<string, unknown>
  ): Promise<SaveResult<{ skill?: Skill }>> =>
    safeRequest<SaveResult<{ skill?: Skill }>>(`/${id}`, "PUT", body),
  remove: (id: number | string): Promise<SaveResult> =>
    safeRequest<SaveResult>(`/${id}`, "DELETE"),
  share: (id: number | string, isShared: boolean): Promise<SaveResult> =>
    safeRequest<SaveResult>(`/${id}/sharing`, "PATCH", { isShared }),
  enable: (id: number | string, enabled: boolean): Promise<SaveResult> =>
    safeRequest<SaveResult>(`/${id}/enabled`, "PUT", { enabled }),
};

export default PersonalSkills;
