const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { AgentRunTask } = require("../models/agentRunTask");

const planSchema = z
  .object({
    tasks: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
          title: z.string().trim().min(1).max(160),
          status: z.enum([
            "pending",
            "running",
            "completed",
            "failed",
            "skipped",
          ]),
          detail: z.string().trim().max(500).default(""),
        })
      )
      .min(1)
      .max(12),
  })
  .superRefine(({ tasks }, ctx) => {
    if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "任务标识不能重复。",
      });
    if (tasks.filter((task) => task.status === "running").length > 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "一次只能标记一个当前任务。",
      });
  });

const updatePlan = defineTool({
  id: "plan.update",
  name: "update_plan",
  description:
    "Show and update a short user-visible task checklist for complex, multi-step work. Create it before substantial work, then update when starting or finishing a step. Use concise Chinese titles, stable IDs and actual statuses. Send the full list each time; mark abandoned steps skipped rather than removing them. At most one step is running. Only mark work completed after checking its result; keep failures and unfinished steps truthful. Simple questions do not need a plan. This only tracks progress: continue doing the work in this same conversation.",
  schema: planSchema,
  action: false,
  effect: "write",
  idempotency: "keyed",
  activity: "更新任务进度",
  execute: async (input, context) => {
    if (
      context.run.runtimeKey !== "default-react" ||
      context.taskId ||
      context.depth > 0
    )
      return {
        ok: false,
        code: "PLAN_NOT_AVAILABLE",
        summary: "当前执行方式不支持修改此任务计划。",
        retryable: false,
      };
    const { tasks } = planSchema.parse(input);
    const saved = await AgentRunTask.saveProgressPlan(context.run.id, tasks);
    await context.emit("plan.updated", { planKind: "progress", tasks: saved });
    return {
      ok: true,
      code: "OK",
      summary: `已完成 ${tasks.filter((task) => task.status === "completed").length}/${tasks.length} 项任务。`,
      data: { tasks },
      retryable: false,
    };
  },
});

module.exports = { updatePlan, planSchema };
