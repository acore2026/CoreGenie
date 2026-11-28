import { api } from "@/utils/api";
import { API_BASE } from "@/utils/constants";

type JobRecord = Record<string, unknown>;
type RunRecord = Record<string, unknown>;

const ScheduledJobs = {
  workspaceBase: (workspaceSlug: string): string =>
    `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/jobs`,

  workspace: {
    list: async function (
      workspaceSlug: string
    ): Promise<{ jobs: JobRecord[]; [key: string]: unknown }> {
      try {
        return await api.get<{ jobs: JobRecord[] }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs`
        );
      } catch {
        return { jobs: [] };
      }
    },

    options: async function (workspaceSlug: string): Promise<{
      agents: unknown[];
      tools: unknown[];
      [key: string]: unknown;
    }> {
      try {
        return await api.get<{ agents: unknown[]; tools: unknown[] }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/options`
        );
      } catch {
        return { agents: [], tools: [] };
      }
    },

    create: async function (
      workspaceSlug: string,
      data: Record<string, unknown>
    ): Promise<{ job: JobRecord | null; error?: string | null }> {
      try {
        return await api.post<{ job: JobRecord | null; error?: string | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs`,
          data
        );
      } catch (error) {
        return { job: null, error: (error as Error).message };
      }
    },

    get: async function (
      workspaceSlug: string,
      jobId: number | string
    ): Promise<{ job: JobRecord | null; [key: string]: unknown }> {
      try {
        return await api.get<{ job: JobRecord | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}`
        );
      } catch {
        return { job: null };
      }
    },

    update: async function (
      workspaceSlug: string,
      jobId: number | string,
      data: Record<string, unknown>
    ): Promise<{ job: JobRecord | null; error?: string | null }> {
      try {
        return await api.put<{ job: JobRecord | null; error?: string | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}`,
          data
        );
      } catch (error) {
        return { job: null, error: (error as Error).message };
      }
    },

    delete: async function (
      workspaceSlug: string,
      jobId: number | string
    ): Promise<{ success: boolean; error?: string | null }> {
      try {
        return await api.delete<{ success: boolean; error?: string | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}`
        );
      } catch {
        return { success: false };
      }
    },

    toggle: async function (
      workspaceSlug: string,
      jobId: number | string
    ): Promise<{ job: JobRecord | null; error?: string | null }> {
      try {
        return await api.post<{ job: JobRecord | null; error?: string | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}/toggle`
        );
      } catch (error) {
        return { job: null, error: (error as Error).message };
      }
    },

    trigger: async function (
      workspaceSlug: string,
      jobId: number | string
    ): Promise<{
      success: boolean;
      error?: string | null;
      [key: string]: unknown;
    }> {
      try {
        return await api.post<{ success: boolean; error?: string | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}/trigger`
        );
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    runs: async function (
      workspaceSlug: string,
      jobId: number | string
    ): Promise<{ job: JobRecord | null; runs: RunRecord[] }> {
      try {
        return await api.get<{ job: JobRecord | null; runs: RunRecord[] }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}/runs`
        );
      } catch {
        return { job: null, runs: [] };
      }
    },

    getRun: async function (
      workspaceSlug: string,
      jobId: number | string,
      runId: number | string
    ): Promise<{ job: JobRecord | null; run: RunRecord | null }> {
      try {
        return await api.get<{ job: JobRecord | null; run: RunRecord | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}/runs/${runId}`
        );
      } catch {
        return { job: null, run: null };
      }
    },

    runAction: async function (
      workspaceSlug: string,
      jobId: number | string,
      runId: number | string,
      action: string
    ): Promise<{
      success: boolean;
      error?: string | null;
      [key: string]: unknown;
    }> {
      try {
        return await api.post<{ success: boolean; error?: string | null }>(
          `/workspace/${encodeURIComponent(workspaceSlug)}/jobs/${jobId}/runs/${runId}/${action}`
        );
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
  },

  list: async function (): Promise<{ jobs: JobRecord[] }> {
    try {
      return await api.get<{ jobs: JobRecord[] }>("/scheduled-jobs");
    } catch {
      return { jobs: [] };
    }
  },

  create: async function (
    data: Record<string, unknown>
  ): Promise<{ job: JobRecord | null; error?: string | null }> {
    try {
      return await api.post<{ job: JobRecord | null; error?: string | null }>(
        "/scheduled-jobs/new",
        data
      );
    } catch (error) {
      return {
        job: null,
        error: (error as Error).message || "Failed to create scheduled job",
      };
    }
  },

  get: async function (
    id: number | string
  ): Promise<{ job: JobRecord | null }> {
    try {
      return await api.get<{ job: JobRecord | null }>(`/scheduled-jobs/${id}`);
    } catch {
      return { job: null };
    }
  },

  update: async function (
    id: number | string,
    data: Record<string, unknown>
  ): Promise<{ job: JobRecord | null; error?: string | null }> {
    try {
      return await api.put<{ job: JobRecord | null; error?: string | null }>(
        `/scheduled-jobs/${id}`,
        data
      );
    } catch (error) {
      return { job: null, error: (error as Error).message };
    }
  },

  delete: async function (
    id: number | string
  ): Promise<{ success: boolean; error?: string | null }> {
    try {
      return await api.delete<{ success: boolean; error?: string | null }>(
        `/scheduled-jobs/${id}`
      );
    } catch {
      return { success: false };
    }
  },

  toggle: async function (
    id: number | string
  ): Promise<{ job: JobRecord | null }> {
    try {
      return await api.post<{ job: JobRecord | null }>(
        `/scheduled-jobs/${id}/toggle`
      );
    } catch {
      return { job: null };
    }
  },

  trigger: async function (
    id: number | string
  ): Promise<{ success: boolean; error?: string | null }> {
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        `/scheduled-jobs/${id}/trigger`
      );
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  runs: async function (id: number | string): Promise<{ runs: RunRecord[] }> {
    try {
      return await api.get<{ runs: RunRecord[] }>(`/scheduled-jobs/${id}/runs`);
    } catch {
      return { runs: [] };
    }
  },

  getRun: async function (
    runId: number | string
  ): Promise<{ run: RunRecord | null; job: JobRecord | null }> {
    try {
      return await api.get<{ run: RunRecord | null; job: JobRecord | null }>(
        `/scheduled-jobs/runs/${runId}`
      );
    } catch {
      return { run: null, job: null };
    }
  },

  markRunRead: async function (
    runId: number | string
  ): Promise<{ success: boolean }> {
    try {
      return await api.post<{ success: boolean }>(
        `/scheduled-jobs/runs/${runId}/read`
      );
    } catch {
      return { success: false };
    }
  },

  continueInThread: async function (runId: number | string): Promise<{
    workspaceSlug: string | null;
    threadSlug: string | null;
    error?: string | null;
  }> {
    try {
      return await api.post<{
        workspaceSlug: string | null;
        threadSlug: string | null;
        error?: string | null;
      }>(`/scheduled-jobs/runs/${runId}/continue`);
    } catch (error) {
      return {
        workspaceSlug: null,
        threadSlug: null,
        error: (error as Error).message,
      };
    }
  },

  availableTools: async function (): Promise<{ tools: unknown[] }> {
    try {
      return await api.get<{ tools: unknown[] }>(
        "/scheduled-jobs/available-tools"
      );
    } catch {
      return { tools: [] };
    }
  },

  killRun: async function (
    runId: number | string
  ): Promise<{ success: boolean; error?: string | null }> {
    try {
      return await api.post<{ success: boolean; error?: string | null }>(
        `/scheduled-jobs/runs/${runId}/kill`
      );
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

export default ScheduledJobs;
