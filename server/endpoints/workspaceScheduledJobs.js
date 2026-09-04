const { ScheduledJob } = require("../models/scheduledJob");
const { ScheduledJobRun } = require("../models/scheduledJobRun");
const { PredefinedAgent } = require("../models/predefinedAgent");
const { User } = require("../models/user");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const {
  validWorkspaceSlug,
  requireWorkspaceParticipant,
} = require("../utils/middleware/validWorkspace");
const { reqBody, safeJsonParse, userFromSession } = require("../utils/http");
const { BackgroundService } = require("../utils/BackgroundWorkers");
const { validateScheduleConfig } = require("../utils/scheduleRules");

const backgroundService = new BackgroundService();

function publicRun(run) {
  return { ...run, result: safeJsonParse(run.result, null) };
}

async function publicJob(job) {
  if (!job) return null;
  const [agent, creator] = await Promise.all([
    job.agent_id ? PredefinedAgent.get(job.agent_id) : null,
    job.created_by ? User.get({ id: job.created_by }) : null,
  ]);
  const { schedule: _internalSchedule, ...safeJob } = job;
  return {
    ...safeJob,
    tools: job.tools === null ? null : safeJsonParse(job.tools, []),
    scheduleConfig: safeJsonParse(job.scheduleConfig, null),
    agent: agent
      ? { id: agent.id, name: agent.name, iconUrl: agent.iconUrl }
      : null,
    creator: creator ? { id: creator.id, username: creator.username } : null,
  };
}

async function jobForWorkspace(workspaceId, jobId) {
  return await ScheduledJob.get({
    id: Number(jobId),
    workspace_id: Number(workspaceId),
  });
}

async function validateAgent(agentId) {
  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) return null;
  return await PredefinedAgent.get(id, { enabledOnly: true });
}

function validateTools(tools) {
  if (tools == null) return { tools: null, error: null };
  if (!Array.isArray(tools))
    return { tools: null, error: "工具必须使用列表形式。" };
  if (tools.length === 0) return { tools: null, error: null };
  return {
    tools: [
      ...new Set(
        tools
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      ),
    ],
    error: null,
  };
}

function workspaceScheduledJobEndpoints(app) {
  if (!app) return;
  const middleware = [
    validatedRequest,
    flexUserRoleValid([ROLES.all]),
    validWorkspaceSlug,
    requireWorkspaceParticipant,
  ];

  app.get(
    "/workspace/:slug/jobs/options",
    middleware,
    async (_request, response) => {
      const [agents, tools] = await Promise.all([
        PredefinedAgent.all({ enabledOnly: true }),
        ScheduledJob.availableTools(),
      ]);
      return response.status(200).json({
        agents: agents.map(({ id, name, description, iconUrl }) => ({
          id,
          name,
          description,
          iconUrl,
        })),
        tools,
      });
    }
  );

  app.get("/workspace/:slug/jobs", middleware, async (_request, response) => {
    const workspace = response.locals.workspace;
    const jobs = await ScheduledJob.where(
      { workspace_id: workspace.id },
      null,
      { createdAt: "desc" },
      { runs: { take: 1, orderBy: { startedAt: "desc" } } }
    );
    return response.status(200).json({
      jobs: await Promise.all(
        jobs.map(async ({ runs, ...job }) => ({
          ...(await publicJob(job)),
          latestRun: runs[0] ? publicRun(runs[0]) : null,
        }))
      ),
    });
  });

  app.post("/workspace/:slug/jobs", middleware, async (request, response) => {
    const workspace = response.locals.workspace;
    const user = await userFromSession(request, response);
    const { name, prompt, agentId, tools, scheduleConfig } = reqBody(request);
    if (!String(name || "").trim())
      return response.status(400).json({ error: "请输入任务名称。" });
    if (!String(prompt || "").trim())
      return response.status(400).json({ error: "请输入任务提示词。" });
    const agent = await validateAgent(agentId);
    if (!agent)
      return response.status(400).json({ error: "请选择可用的 Agent。" });
    const toolSelection = validateTools(tools);
    if (toolSelection.error)
      return response.status(400).json({ error: toolSelection.error });
    const schedule = validateScheduleConfig(scheduleConfig);
    if (schedule.error)
      return response.status(400).json({ error: schedule.error });
    const activation = await ScheduledJob.canActivate();
    if (!activation.allowed)
      return response.status(400).json({
        error: `当前最多可以启用 ${activation.limit} 个计划任务。`,
      });

    const { job, error } = await ScheduledJob.create({
      name: String(name).trim(),
      prompt: String(prompt).trim(),
      tools: toolSelection.tools,
      schedule:
        schedule.config.type === "once" ? schedule.config.scheduledAt : "",
      scheduleType: schedule.config.type,
      scheduleConfig: schedule.config,
      timezone: schedule.config.timezone,
      workspace_id: workspace.id,
      agent_id: agent.id,
      created_by: user?.id || null,
    });
    if (!job) return response.status(400).json({ error });
    backgroundService.addScheduledJob(job);
    return response.status(201).json({ job: await publicJob(job) });
  });

  app.get(
    "/workspace/:slug/jobs/:jobId",
    middleware,
    async (request, response) => {
      const job = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!job) return response.status(404).json({ error: "任务不存在。" });
      return response.status(200).json({ job: await publicJob(job) });
    }
  );

  app.put(
    "/workspace/:slug/jobs/:jobId",
    middleware,
    async (request, response) => {
      const current = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!current) return response.status(404).json({ error: "任务不存在。" });
      const body = reqBody(request);
      const updates = {};
      if (body.name !== undefined) {
        if (!String(body.name).trim())
          return response.status(400).json({ error: "请输入任务名称。" });
        updates.name = String(body.name).trim();
      }
      if (body.prompt !== undefined) {
        if (!String(body.prompt).trim())
          return response.status(400).json({ error: "请输入任务提示词。" });
        updates.prompt = String(body.prompt).trim();
      }
      if (body.agentId !== undefined) {
        const agent = await validateAgent(body.agentId);
        if (!agent)
          return response.status(400).json({ error: "请选择可用的 Agent。" });
        updates.agent_id = agent.id;
      }
      if (body.tools !== undefined) {
        const selection = validateTools(body.tools);
        if (selection.error)
          return response.status(400).json({ error: selection.error });
        updates.tools = selection.tools;
      }
      if (body.scheduleConfig !== undefined) {
        const schedule = validateScheduleConfig(body.scheduleConfig);
        if (schedule.error)
          return response.status(400).json({ error: schedule.error });
        updates.scheduleConfig = schedule.config;
        updates.scheduleType = schedule.config.type;
        updates.timezone = schedule.config.timezone;
        updates.schedule =
          schedule.config.type === "once" ? schedule.config.scheduledAt : "";
      }
      if (body.enabled !== undefined) {
        updates.enabled = Boolean(body.enabled);
        if (updates.enabled && !current.enabled) {
          const config =
            updates.scheduleConfig ||
            safeJsonParse(current.scheduleConfig, null);
          if (
            config?.type === "once" &&
            (!config.scheduledAt || new Date(config.scheduledAt) <= new Date())
          )
            return response.status(400).json({
              error: "这个指定时间已经过去，请先编辑执行时间。",
            });
          const activation = await ScheduledJob.canActivate({
            excludeId: current.id,
          });
          if (!activation.allowed)
            return response.status(400).json({
              error: `当前最多可以启用 ${activation.limit} 个计划任务。`,
            });
        }
      }
      const { job, error } = await ScheduledJob.update(current.id, updates);
      if (!job) return response.status(400).json({ error });
      await backgroundService.syncScheduledJob(job.id);
      return response.status(200).json({ job: await publicJob(job) });
    }
  );

  app.delete(
    "/workspace/:slug/jobs/:jobId",
    middleware,
    async (request, response) => {
      const job = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!job) return response.status(404).json({ error: "任务不存在。" });
      backgroundService.removeScheduledJob(job.id);
      return response.status(200).json({
        success: await ScheduledJob.delete(job.id),
      });
    }
  );

  app.post(
    "/workspace/:slug/jobs/:jobId/toggle",
    middleware,
    async (request, response) => {
      const job = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!job) return response.status(404).json({ error: "任务不存在。" });
      if (!job.enabled && job.scheduleType === "once") {
        const config = safeJsonParse(job.scheduleConfig, null);
        if (!config?.scheduledAt || new Date(config.scheduledAt) <= new Date())
          return response.status(400).json({
            error: "这个指定时间已经过去，请先编辑执行时间。",
          });
      }
      if (!job.enabled) {
        const activation = await ScheduledJob.canActivate({
          excludeId: job.id,
        });
        if (!activation.allowed)
          return response.status(400).json({
            error: `当前最多可以启用 ${activation.limit} 个计划任务。`,
          });
      }
      const { job: updated, error } = await ScheduledJob.update(job.id, {
        enabled: !job.enabled,
      });
      if (!updated) return response.status(400).json({ error });
      await backgroundService.syncScheduledJob(job.id);
      return response.status(200).json({ job: await publicJob(updated) });
    }
  );

  app.post(
    "/workspace/:slug/jobs/:jobId/trigger",
    middleware,
    async (request, response) => {
      const job = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!job) return response.status(404).json({ error: "任务不存在。" });
      const run = await backgroundService.enqueueScheduledJob(job.id);
      return response.status(200).json({
        success: true,
        skipped: !run,
        run: run ? publicRun(run) : null,
      });
    }
  );

  app.get(
    "/workspace/:slug/jobs/:jobId/runs",
    middleware,
    async (request, response) => {
      const job = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!job) return response.status(404).json({ error: "任务不存在。" });
      const runs = await ScheduledJobRun.where({ jobId: job.id }, null, {
        startedAt: "desc",
      });
      return response.status(200).json({
        job: await publicJob(job),
        runs: runs.map(publicRun),
      });
    }
  );

  app.get(
    "/workspace/:slug/jobs/:jobId/runs/:runId",
    middleware,
    async (request, response) => {
      const job = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!job) return response.status(404).json({ error: "任务不存在。" });
      const run = await ScheduledJobRun.get({
        id: Number(request.params.runId),
        jobId: job.id,
      });
      if (!run) return response.status(404).json({ error: "运行记录不存在。" });
      return response.status(200).json({
        job: await publicJob(job),
        run: publicRun(run),
      });
    }
  );

  app.post(
    "/workspace/:slug/jobs/:jobId/runs/:runId/:action",
    middleware,
    async (request, response) => {
      const job = await jobForWorkspace(
        response.locals.workspace.id,
        request.params.jobId
      );
      if (!job) return response.status(404).json({ error: "任务不存在。" });
      const run = await ScheduledJobRun.get({
        id: Number(request.params.runId),
        jobId: job.id,
      });
      if (!run) return response.status(404).json({ error: "运行记录不存在。" });
      const action = request.params.action;
      if (action === "read") {
        await ScheduledJobRun.markRead(run.id);
        return response.status(200).json({ success: true });
      }
      if (action === "kill") {
        if (!["queued", "running"].includes(run.status))
          return response.status(400).json({ error: "这次运行已经结束。" });
        const killed = backgroundService.killRun(job.id, run.id);
        if (!killed) await ScheduledJobRun.kill(run.id);
        return response.status(200).json({ success: true });
      }
      if (action === "continue") {
        const user = await userFromSession(request, response);
        const result = await ScheduledJobRun.continueInWorkspace(
          run.id,
          response.locals.workspace,
          user
        );
        if (result.error)
          return response.status(500).json({ error: result.error });
        return response.status(200).json({
          workspaceSlug: result.workspace.slug,
          threadSlug: result.thread.slug,
        });
      }
      return response.status(400).json({ error: "不支持的操作。" });
    }
  );
}

module.exports = {
  publicJob,
  workspaceScheduledJobEndpoints,
};
