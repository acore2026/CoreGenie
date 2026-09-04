import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const ScheduledJobs = {
  workspaceBase: (workspaceSlug) =>
    `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/jobs`,
  workspace: {
    list: async function (workspaceSlug) {
      return await fetch(ScheduledJobs.workspaceBase(workspaceSlug), {
        headers: baseHeaders(),
      })
        .then((res) => res.json())
        .catch(() => ({ jobs: [] }));
    },
    options: async function (workspaceSlug) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/options`,
        { headers: baseHeaders() }
      )
        .then((res) => res.json())
        .catch(() => ({ agents: [], tools: [] }));
    },
    create: async function (workspaceSlug, data) {
      return await fetch(ScheduledJobs.workspaceBase(workspaceSlug), {
        method: "POST",
        headers: baseHeaders(),
        body: JSON.stringify(data),
      })
        .then(async (res) => {
          const data = await res.json();
          return res.ok ? data : { job: null, error: data.error };
        })
        .catch((error) => ({ job: null, error: error.message }));
    },
    get: async function (workspaceSlug, jobId) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}`,
        { headers: baseHeaders() }
      )
        .then((res) => res.json())
        .catch(() => ({ job: null }));
    },
    update: async function (workspaceSlug, jobId, data) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}`,
        { method: "PUT", headers: baseHeaders(), body: JSON.stringify(data) }
      )
        .then(async (res) => {
          const data = await res.json();
          return res.ok ? data : { job: null, error: data.error };
        })
        .catch((error) => ({ job: null, error: error.message }));
    },
    delete: async function (workspaceSlug, jobId) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}`,
        { method: "DELETE", headers: baseHeaders() }
      )
        .then((res) => res.json())
        .catch(() => ({ success: false }));
    },
    toggle: async function (workspaceSlug, jobId) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}/toggle`,
        { method: "POST", headers: baseHeaders() }
      )
        .then(async (res) => {
          const data = await res.json();
          return res.ok ? data : { job: null, error: data.error };
        })
        .catch((error) => ({ job: null, error: error.message }));
    },
    trigger: async function (workspaceSlug, jobId) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}/trigger`,
        { method: "POST", headers: baseHeaders() }
      )
        .then(async (res) => {
          const data = await res.json();
          return res.ok ? data : { success: false, error: data.error };
        })
        .catch((error) => ({ success: false, error: error.message }));
    },
    runs: async function (workspaceSlug, jobId) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}/runs`,
        { headers: baseHeaders() }
      )
        .then((res) => res.json())
        .catch(() => ({ job: null, runs: [] }));
    },
    getRun: async function (workspaceSlug, jobId, runId) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}/runs/${runId}`,
        { headers: baseHeaders() }
      )
        .then((res) => res.json())
        .catch(() => ({ job: null, run: null }));
    },
    runAction: async function (workspaceSlug, jobId, runId, action) {
      return await fetch(
        `${ScheduledJobs.workspaceBase(workspaceSlug)}/${jobId}/runs/${runId}/${action}`,
        { method: "POST", headers: baseHeaders() }
      )
        .then(async (res) => {
          const data = await res.json();
          return res.ok ? data : { success: false, error: data.error };
        })
        .catch((error) => ({ success: false, error: error.message }));
    },
  },
  list: async function () {
    return await fetch(`${API_BASE}/scheduled-jobs`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ jobs: [] }));
  },

  create: async function (data) {
    return await fetch(`${API_BASE}/scheduled-jobs/new`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .catch(() => ({ job: null, error: "Failed to create scheduled job" }));
  },

  get: async function (id) {
    return await fetch(`${API_BASE}/scheduled-jobs/${id}`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ job: null }));
  },

  update: async function (id, data) {
    return await fetch(`${API_BASE}/scheduled-jobs/${id}`, {
      method: "PUT",
      headers: baseHeaders(),
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .catch((e) => ({
        job: null,
        error: e.message,
      }));
  },

  delete: async function (id) {
    return await fetch(`${API_BASE}/scheduled-jobs/${id}`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ success: false }));
  },

  toggle: async function (id) {
    return await fetch(`${API_BASE}/scheduled-jobs/${id}/toggle`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ job: null }));
  },

  trigger: async function (id) {
    return await fetch(`${API_BASE}/scheduled-jobs/${id}/trigger`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  runs: async function (id) {
    return await fetch(`${API_BASE}/scheduled-jobs/${id}/runs`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ runs: [] }));
  },

  getRun: async function (runId) {
    return await fetch(`${API_BASE}/scheduled-jobs/runs/${runId}`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ run: null, job: null }));
  },

  markRunRead: async function (runId) {
    return await fetch(`${API_BASE}/scheduled-jobs/runs/${runId}/read`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ success: false }));
  },

  continueInThread: async function (runId) {
    return await fetch(`${API_BASE}/scheduled-jobs/runs/${runId}/continue`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({
        workspaceSlug: null,
        threadSlug: null,
        error: e.message,
      }));
  },

  availableTools: async function () {
    return await fetch(`${API_BASE}/scheduled-jobs/available-tools`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ tools: [] }));
  },

  killRun: async function (runId) {
    return await fetch(`${API_BASE}/scheduled-jobs/runs/${runId}/kill`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },
};

export default ScheduledJobs;
