const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { ScheduledJob } = require("../models/scheduledJob");
const { PredefinedAgent } = require("../models/predefinedAgent");
const { BackgroundService } = require("../utils/BackgroundWorkers");
const { validateScheduleConfig } = require("../utils/scheduleRules");

const scheduleConfigSchema = z.object({
  type: z.enum(["once", "recurring"]),
  timezone: z.string().min(1),
  date: z.string().optional(),
  time: z.string().optional(),
  frequency: z
    .enum(["minute", "hour", "daily", "weekly", "monthly"])
    .optional(),
  interval: z.number().int().positive().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  day: z.union([z.number().int().min(1).max(31), z.literal("last")]).optional(),
});

async function selectedAgent(agentId, agentName, fallbackAgent) {
  if (agentId) return await PredefinedAgent.get(agentId, { enabledOnly: true });
  if (agentName) {
    const normalized = String(agentName).trim().toLocaleLowerCase();
    return (await PredefinedAgent.all({ enabledOnly: true })).find(
      (agent) => agent.name.toLocaleLowerCase() === normalized
    );
  }
  return fallbackAgent?.id
    ? await PredefinedAgent.get(fallbackAgent.id, { enabledOnly: true })
    : null;
}

const createScheduledJob = defineTool({
  id: "schedule.create",
  name: "schedule_create",
  description:
    "Create a one-time or recurring Agent job for the current Workspace. Use structured local date/time fields only; never ask for or generate a cron expression. The job runs later without chat history, so the prompt must be self-contained.",
  action: true,
  effect: "write",
  idempotency: "keyed",
  concurrencyKey: "schedule-create",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(40_000),
    scheduleConfig: scheduleConfigSchema,
    agentId: z.number().int().positive().optional(),
    agentName: z.string().trim().min(1).max(80).optional(),
  }),
  activity: ({ name }) => `创建计划任务：${name}`,
  execute: async (args, context) => {
    if (context.run?.source === "scheduled")
      return {
        ok: false,
        code: "SCHEDULE_RECURSION_BLOCKED",
        summary: "计划任务运行时不能继续创建新的计划任务。",
        data: null,
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };
    const schedule = validateScheduleConfig(args.scheduleConfig);
    if (schedule.error)
      return {
        ok: false,
        code: "INVALID_SCHEDULE",
        summary: schedule.error,
        data: null,
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };
    const agent = await selectedAgent(
      args.agentId,
      args.agentName,
      context.agent
    );
    if (!agent)
      return {
        ok: false,
        code: "AGENT_NOT_FOUND",
        summary: "没有找到可用的执行 Agent。",
        data: null,
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };

    const activation = await ScheduledJob.canActivate();
    if (!activation.allowed)
      return {
        ok: false,
        code: "SCHEDULE_LIMIT_REACHED",
        summary: `当前最多可以启用 ${activation.limit} 个计划任务。`,
        data: null,
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };

    const { job, error } = await ScheduledJob.create({
      name: args.name,
      prompt: args.prompt,
      tools: null,
      schedule:
        schedule.config.type === "once" ? schedule.config.scheduledAt : "",
      scheduleType: schedule.config.type,
      scheduleConfig: schedule.config,
      timezone: schedule.config.timezone,
      workspace_id: context.workspace.id,
      agent_id: agent.id,
      created_by: context.user?.id || null,
    });
    if (!job)
      return {
        ok: false,
        code: "SCHEDULE_CREATE_FAILED",
        summary: error || "计划任务创建失败。",
        data: null,
        evidenceIds: [],
        artifactIds: [],
        retryable: false,
      };
    new BackgroundService().addScheduledJob(job);
    return {
      ok: true,
      code: "SCHEDULE_CREATED",
      summary: `已创建计划任务“${job.name}”。`,
      data: {
        jobId: job.id,
        workspaceSlug: context.workspace.slug,
        agent: { id: agent.id, name: agent.name },
        nextRunAt: job.nextRunAt,
        url: `/workspace/${context.workspace.slug}/jobs/${job.id}/runs`,
      },
      evidenceIds: [],
      artifactIds: [],
      retryable: false,
    };
  },
});

module.exports = { createScheduledJob, selectedAgent };
