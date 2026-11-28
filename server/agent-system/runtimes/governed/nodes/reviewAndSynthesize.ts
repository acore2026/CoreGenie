const { AgentRunTask } = require("../../../../models/agentRunTask");
const { AgentRunEvidence } = require("../../../../models/agentRunEvidence");
const { agentListForPrompt } = require("../../../../resources/agents");
const { createChatModel } = require("../../../../resources/models");
const { activatedSkillsPrompt } = require("../../../activatedSkills");
const { contentText } = require("../../../message");
const {
  childRunnableConfig,
  withAgentStepTrace,
} = require("../../../observability");
const { sourceFromEvidence } = require("../../evidenceResearch");
const { DEFAULTS, reviewSchema } = require("../types.ts");
const { normalizeReviewDecision } = require("../grounding.ts");
const { invokeStructured, roleModel, validatePlan } = require("../planning.ts");

type GovernedContext = import("../types.ts").GovernedContext;
type GovernedStateValue = import("../types.ts").GovernedStateValue;

function createReviewNode(
  context: GovernedContext,
  { basePrompt }: { basePrompt: string }
) {
  const { run, workspace, emit, runnableConfig } = context;

  return async (state: GovernedStateValue) => {
    await emit("activity.updated", {
      phase: "review",
      summary: `检查 ${state.taskResults.length} 个任务结果`,
    });
    try {
      const activatedSkillContext = activatedSkillsPrompt(
        state.activatedSkills
      );
      const decision = await invokeStructured({
        run,
        workspace,
        role: "reviewer",
        schema: reviewSchema,
        name: "review-agent-work",
        system: `${basePrompt}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nReview completed and failed tasks against the user's request and the activated Skill instructions. Accept when supported, partial when the best possible answer should be returned with explicit gaps, or revise only for a material repair that can succeed with a different task. If the user requested a list or named fields but task results contain only a count, artifact path, truncated table, or incomplete rows, revise with a focused read task that returns every requested row and field in a compact form. Shared sources and directories should be stated once instead of repeated in every row. Do not accept a file path, output-length truncation, or fields omitted by truncation as a substitute for requested user-visible content. Do not repeat failed work unchanged.`,
        user: `Request:\n${state.request}\n\nPlan:\n${JSON.stringify(state.plan)}\n\nResults:\n${JSON.stringify(state.taskResults)}\n\nEvidence:\n${JSON.stringify(state.evidence)}`,
        runnableConfig,
      });
      return {
        review: normalizeReviewDecision(decision, state.taskResults),
      };
    } catch (error) {
      return {
        review: {
          status: "partial",
          gaps: [`Review model failed: ${(error as Error).message}`],
          replacementTasks: [],
        },
      };
    }
  };
}

function afterReview(
  state: GovernedStateValue
): "apply_revision" | "synthesize" {
  if (
    state.review?.status === "revise" &&
    state.reviewRound < DEFAULTS.maxReviewRounds &&
    state.review?.replacementTasks?.length
  )
    return "apply_revision";
  return "synthesize";
}

function createApplyRevisionNode(context: GovernedContext) {
  const { run, agent, emit } = context;

  return async (state: GovernedStateValue) => {
    const availableAgents = await agentListForPrompt(agent.id);
    const revised = validatePlan(
      {
        goal: state.plan!.goal,
        tasks: (state.review?.replacementTasks || []).map(
          (taskItem, index) => ({
            ...taskItem,
            id: `repair-${state.reviewRound + 1}-${taskItem.id || index + 1}`,
            dependsOn: [],
          })
        ),
      },
      {
        run,
        agent,
        availableAgents,
        activatedSkills: state.activatedSkills,
      }
    );
    const plan = {
      ...state.plan!,
      tasks: [...state.plan!.tasks, ...revised.tasks],
    };
    await AgentRunTask.upsertPlan(run.id, revised.tasks);
    await emit("plan.updated", {
      goal: plan.goal,
      tasks: plan.tasks,
      reviewRound: state.reviewRound + 1,
    });
    for (const taskItem of revised.tasks)
      await emit("task.created", { task: taskItem, repair: true });
    return { plan, reviewRound: state.reviewRound + 1, review: null };
  };
}

function createSynthesizeNode(
  context: GovernedContext,
  { basePrompt }: { basePrompt: string }
) {
  const { run, workspace, emit, signal, runnableConfig, onToken } = context;

  return async (state: GovernedStateValue) =>
    withAgentStepTrace(
      "synthesize-agent-response",
      {
        input: {
          request: state.request,
          tasks: state.taskResults.length,
          evidence: state.evidence.length,
        },
        metadata: { role: "controller", reviewRound: state.reviewRound },
      },
      async () => {
        await emit("activity.updated", {
          phase: "writing",
          summary: "根据已完成的工作和可用资料整理回答",
        });
        const evidence = state.evidence.map((item, index) => ({
          citation: `E${index + 1}`,
          ...item,
        }));
        const activatedSkillContext = activatedSkillsPrompt(
          state.activatedSkills
        );
        const model = createChatModel({
          workspace,
          model: roleModel(run, "controller"),
          temperature: run.configuration?.temperature ?? 0.2,
          thinking: run.configuration?.thinking !== false,
        });
        let text = "";
        try {
          const stream = await model.stream(
            [
              {
                role: "system",
                content: `${basePrompt}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nWrite the final user response from the task results while following the activated Skill instructions. Preserve successful work when some tasks failed. State material gaps plainly. Cite evidence inline as [E1], [E2], and so on. When the user requested a list or named fields and task results contain them, include every complete row in the answer; never replace requested user-visible content with only an artifact path, an offer to retrieve it later, or a truncation notice. Keep long tables compact by stating a shared source or directory once outside the table instead of repeating the same URL or path in every row. Do not expose internal plans or JSON. You have no tools in this step.`,
              },
              {
                role: "user",
                content: `Request:\n${state.request}\n\nReview:\n${JSON.stringify(state.review)}\n\nTask results:\n${JSON.stringify(state.taskResults)}\n\nEvidence:\n${JSON.stringify(evidence)}`,
              },
            ],
            {
              ...childRunnableConfig(runnableConfig, {
                tags: ["governed-agent", "role:controller", "synthesis"],
                metadata: { role: "controller" },
              }),
              runName: "synthesize-agent-response",
              signal,
            }
          );
          for await (const chunk of stream) {
            const token = contentText(chunk.content);
            if (!token) continue;
            text += token;
            await onToken(token);
          }
        } catch (error) {
          await emit("model.failed", {
            role: "controller",
            error: (error as Error).message,
          });
        }
        if (!text.trim()) {
          const completed = state.taskResults.filter(
            (item) => item.status === "completed"
          );
          const failed = state.taskResults.filter(
            (item) => item.status !== "completed"
          );
          text = completed.length
            ? `${completed.map((item) => item.summary).join("\n\n")}\n\n${failed.length ? `Incomplete work:\n${failed.map((item) => `- ${item.summary}`).join("\n")}` : ""}`.trim()
            : `I could not complete this request. ${failed
                .map((item) => item.error || item.summary)
                .filter(Boolean)
                .join(" ")}`;
          await onToken(text);
        }
        const used = new Set(
          [...text.matchAll(/\[E(\d+)\]/g)].map((match) => Number(match[1]) - 1)
        );
        const usedEvidence = [...used]
          .map((index) => evidence[index])
          .filter(Boolean);
        await AgentRunEvidence.markUsed(usedEvidence.map((item) => item.id));
        return {
          finalResponse: text,
          sources: usedEvidence.map(sourceFromEvidence),
        };
      }
    );
}

module.exports = {
  afterReview,
  createApplyRevisionNode,
  createReviewNode,
  createSynthesizeNode,
};
