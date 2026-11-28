const { Send } = require("@langchain/langgraph");
const { AgentRunTask } = require("../../../../models/agentRunTask");
const { AgentRunEvidence } = require("../../../../models/agentRunEvidence");
const { AgentToolExecution } = require("../../../../models/agentToolExecution");
const { resolveAgent } = require("../../../../resources/agents");
const { buildAgentGraph } = require("../../../graph");
const {
  executionLimitsDisabled,
  recursionLimitFor,
} = require("../../../executionLimits");
const {
  activatedSkillsPrompt,
  restoreActivatedSkills,
} = require("../../../activatedSkills");
const { getCheckpointer } = require("../../../checkpointer");
const { finalText } = require("../../../message");
const { childRunnableConfig } = require("../../../observability");
const {
  normalizeEvidence,
  parseJsonObject,
} = require("../../evidenceResearch");
const { DEFAULTS, workerResultSchema } = require("../types.ts");
const {
  blockedTaskResults,
  groundWorkerResultInToolExecutions,
  isTerminalTaskError,
  priorToolResultsContext,
  rethrowWorkerInterrupt,
  shouldRetryNoProgressTask,
  taskCanDispatch,
  taskHasWriteTool,
  taskRequiredCompletionTools,
  taskTerminalError,
  workerContinuationInstruction,
  workerResultFromPlainText,
  workerSystemPrompt,
} = require("../grounding.ts");
const {
  contextPrompt,
  effectiveTaskToolIds,
  roleModel,
  skillToolRestrictionsEnabled,
} = require("../planning.ts");
const { isQuick3gppLookupTask } = require("../workflows.ts");

type GovernedContext = import("../types.ts").GovernedContext;
type GovernedStateValue = import("../types.ts").GovernedStateValue;
type TaskResult = import("../types.ts").TaskResult;

function createScheduleNode(context: GovernedContext) {
  const { emit } = context;
  return async (state: GovernedStateValue) => {
    const skipped: TaskResult[] = blockedTaskResults(
      state.plan?.tasks || [],
      state.taskResults
    );
    for (const result of skipped) {
      await AgentRunTask.update(result.id, {
        status: "skipped",
        resultSummary: result.summary,
        completedAt: new Date(),
      });
      await emit("task.skipped", {
        taskId: result.id,
        reason: result.summary,
      });
    }
    return { taskResults: skipped };
  };
}

function createDispatchRouter() {
  return (state: GovernedStateValue) => {
    const results = new Map(state.taskResults.map((item) => [item.id, item]));
    const ready = (state.plan?.tasks || []).filter(
      (taskItem) =>
        !results.has(taskItem.id) && taskCanDispatch(taskItem, results)
    );
    if (!ready.length) return "review_results";
    return ready.slice(0, DEFAULTS.maxConcurrency).map(
      (workItem) =>
        new Send("worker", {
          ...state,
          workItem,
        })
    );
  };
}

function createWorkerNode(
  context: GovernedContext,
  {
    basePrompt,
    sharedBudget,
    activatedSkillScope,
  }: {
    basePrompt: string;
    sharedBudget: Record<string, any>;
    activatedSkillScope: Map<string, any>;
  }
) {
  const { run, workspace, user, agent, emit, signal } = context;

  return async (state: GovernedStateValue, config: Record<string, unknown>) => {
    const taskItem = state.workItem!;
    const startedAt = Date.now();
    const workerAgent = taskItem.assignedAgentId
      ? await resolveAgent(taskItem.assignedAgentId)
      : agent;
    if (!workerAgent) {
      return {
        taskResults: [
          {
            id: taskItem.id,
            status: "failed",
            summary: "The assigned Agent is unavailable.",
            error: "Assigned Agent is unavailable.",
            evidence: [],
            unresolved: ["Assigned Agent is unavailable."],
          },
        ],
      };
    }
    await AgentRunTask.update(taskItem.id, {
      status: "running",
      progress: taskItem.title,
      startedAt: new Date(),
    });
    await emit("task.started", {
      taskId: taskItem.id,
      title: taskItem.title,
      agent: { id: workerAgent.id, name: workerAgent.name },
      activatedSkills: state.activatedSkills.map((skill) => ({
        name: skill.name,
        revision: skill.revision || null,
      })),
    });
    await emit("task.progress", {
      taskId: taskItem.id,
      phase: "working",
      summary: taskItem.title,
    });
    try {
      await restoreActivatedSkills(
        state.activatedSkills,
        workspace,
        activatedSkillScope,
        user?.id ?? run?.user_id
      );
    } catch (error) {
      const failed = {
        id: taskItem.id,
        status: "failed",
        summary: `Could not start ${taskItem.title}.`,
        error: (error as Error).message,
        evidence: [],
        unresolved: [(error as Error).message],
        durationMs: Date.now() - startedAt,
        agent: { id: workerAgent.id, name: workerAgent.name },
      };
      await AgentRunTask.update(taskItem.id, {
        status: "failed",
        error: failed.error,
        resultSummary: failed.summary,
        progress: null,
        completedAt: new Date(),
      });
      await emit("task.failed", { taskId: taskItem.id, error: failed.error });
      return { taskResults: [failed] };
    }
    const dependencyResults = state.taskResults.filter((item) =>
      taskItem.dependsOn.includes(item.id)
    );
    const requestedToolIds = taskItem.allowedToolIds;
    const allowedToolIds = effectiveTaskToolIds(
      requestedToolIds,
      workerAgent,
      state.activatedSkills,
      skillToolRestrictionsEnabled(run)
    );
    const requiredToolIds = taskRequiredCompletionTools(
      run,
      allowedToolIds,
      taskItem
    );
    const quick3gppLookupTask = isQuick3gppLookupTask(taskItem);
    const limitsDisabled = executionLimitsDisabled(run);
    const workerRun = {
      ...run,
      configuration: {
        ...run.configuration,
        thinking:
          run.configuration?.thinking ??
          workerAgent.runtimeConfig?.thinking ??
          run.runtimeSnapshot?.runtimeConfig?.thinking ??
          true,
        model: roleModel(run, "worker"),
        toolOverrides: allowedToolIds,
        maxModelCallsPerTask: limitsDisabled
          ? null
          : run.configuration?.maxModelCallsPerTask ||
            (quick3gppLookupTask
              ? DEFAULTS.maxQuickLookupModelCalls
              : DEFAULTS.maxTaskModelCalls),
      },
    };
    let lastError: Error | null = null;
    const maxWorkerAttempts = quick3gppLookupTask ? 1 : 2;
    for (let attempt = 1; attempt <= maxWorkerAttempts; attempt += 1) {
      const taskController = new AbortController();
      const taskSignal = AbortSignal.any([
        signal || new AbortController().signal,
        taskController.signal,
      ]);
      const maxTaskMs = limitsDisabled
        ? null
        : Math.min(
            Math.max(
              Number(taskItem.budget?.maxElapsedMs) || DEFAULTS.maxTaskMs,
              60_000
            ),
            DEFAULTS.maxTaskMs
          );
      const taskTimeout = limitsDisabled
        ? null
        : setTimeout(
            () =>
              taskController.abort(
                taskTerminalError(
                  "TASK_TIME_BUDGET_EXHAUSTED",
                  `任务“${taskItem.title}”运行超过 ${Math.round((maxTaskMs || DEFAULTS.maxTaskMs) / 60_000)} 分钟，已停止当前步骤。`
                )
              ),
            maxTaskMs || DEFAULTS.maxTaskMs
          );
      taskTimeout?.unref?.();
      try {
        const durableTask = await AgentRunTask.get(taskItem.id);
        if (["cancelled", "skipped"].includes(durableTask?.status)) {
          const stopped = {
            id: taskItem.id,
            status: durableTask.status,
            summary:
              durableTask.resultSummary ||
              `Task ${durableTask.status} by the user.`,
            error: durableTask.error,
            evidence: [],
            unresolved: [],
          };
          return { taskResults: [stopped] };
        }
        const priorExecutions =
          attempt > 1
            ? await AgentToolExecution.listForTask(run.id, taskItem.id)
            : [];
        const workerGraph = await buildAgentGraph({
          run: workerRun,
          workspace,
          user,
          agent: workerAgent,
          emit,
          signal: taskSignal,
          maxConsecutiveNoProgress: DEFAULTS.maxConsecutiveNoProgress,
          onNoProgress: (error: unknown) => taskController.abort(error),
          budget: sharedBudget,
          depth: context.depth || 0,
          maxLocalToolCalls: limitsDisabled
            ? null
            : quick3gppLookupTask
              ? DEFAULTS.maxQuickLookupToolCalls
              : DEFAULTS.maxTaskToolCalls,
          systemPromptOverride: workerSystemPrompt({
            basePrompt: workerAgent.systemPrompt || basePrompt,
            userRequest: state.request,
            taskItem,
            allowedToolIds,
            requiredToolIds,
            dependencyResults,
            activatedSkillContext: activatedSkillsPrompt(
              state.activatedSkills,
              new Set(allowedToolIds)
            ),
            priorToolResults: priorToolResultsContext(priorExecutions),
          }),
          includeSkillCatalog: false,
          activatedSkillScope,
          checkpointerOverride: await getCheckpointer(),
          taskId: taskItem.id,
          taskTitle: taskItem.title,
        });
        const invocationConfig = {
          ...childRunnableConfig(config, {
            tags: ["governed-worker"],
            metadata: {
              taskId: taskItem.id,
              agentId: String(workerAgent.id),
              attempt: String(attempt),
            },
          }),
          configurable: {
            thread_id: `${run.checkpointThreadId}:task:${taskItem.id}:attempt:${attempt}`,
          },
          recursionLimit: recursionLimitFor(
            run,
            DEFAULTS.maxTaskToolCalls * 4 + 200
          ),
          signal: taskSignal,
        };
        let invocationInput: { messages: unknown[] } = {
          messages: [
            {
              role: "user",
              content: `${taskItem.objective}${contextPrompt(state.contextItems)}`,
            },
          ],
        };
        let resultState: any;
        let parsed: any = null;
        let parseError: Error | null = null;
        let missingToolIds: string[] = [];
        for (let continuation = 0; continuation < 3; continuation += 1) {
          resultState = await workerGraph.invoke(
            invocationInput,
            invocationConfig
          );
          try {
            parsed = workerResultSchema.parse(
              parseJsonObject(finalText(resultState))
            );
            parseError = null;
          } catch (error) {
            parsed = null;
            parseError = error as Error;
          }
          const taskExecutions = await AgentToolExecution.listForTask(
            run.id,
            taskItem.id
          );
          const completedToolIds = new Set<string>(
            taskExecutions
              .filter(
                (item: any) =>
                  item.status === "completed" && item.result?.ok !== false
              )
              .map((item: any) => item.tool_id)
          );
          missingToolIds = requiredToolIds.filter(
            (toolId: string) => !completedToolIds.has(toolId)
          );
          if (!parsed) {
            parsed = workerResultFromPlainText(resultState, missingToolIds);
          }
          if (parsed) {
            parseError = null;
          }
          if (parsed && !missingToolIds.length) break;
          if (continuation === 2) break;

          const reasons = [
            parseError
              ? "Your previous response was not the required JSON worker result."
              : null,
            missingToolIds.length
              ? `Required completion tools have not succeeded: ${missingToolIds.join(", ")}.`
              : null,
          ].filter(Boolean) as string[];
          await emit("task.progress", {
            taskId: taskItem.id,
            phase: "continuing",
            summary: "Continuing unfinished worker actions before review",
          });
          const continuationInstruction = workerContinuationInstruction({
            reasons,
            missingToolIds,
            completedToolIds: [...completedToolIds],
            writeEnabled:
              taskItem.writeIntent === true && taskHasWriteTool(allowedToolIds),
          });
          invocationInput = {
            messages: [
              ...(Array.isArray(resultState?.messages)
                ? resultState.messages
                : []),
              {
                role: "user",
                content: continuationInstruction,
              },
            ],
          };
        }
        if (!parsed) {
          parsed = {
            summary:
              finalText(resultState) || "Worker completed without a summary.",
            evidence: [],
            unresolved: [
              `Structured result was unavailable: ${parseError?.message || "unknown parse error"}`,
              ...(missingToolIds.length
                ? [`Missing completion tools: ${missingToolIds.join(", ")}`]
                : []),
            ],
          };
        }
        if (missingToolIds.length)
          throw new Error(
            `此任务缺少成功的必要工具调用：${missingToolIds.join(", ")}`
          );
        parsed = groundWorkerResultInToolExecutions(
          parsed,
          taskItem,
          requiredToolIds,
          await AgentToolExecution.listForTask(run.id, taskItem.id)
        );
        const evidence = normalizeEvidence(parsed.evidence, {
          id: taskItem.id,
        });
        const latestTask = await AgentRunTask.get(taskItem.id);
        if (["cancelled", "skipped"].includes(latestTask?.status)) {
          return {
            taskResults: [
              {
                id: taskItem.id,
                status: latestTask.status,
                summary:
                  latestTask.resultSummary ||
                  `Task ${latestTask.status} by the user.`,
                error: latestTask.error,
                evidence: [],
                unresolved: [],
              },
            ],
          };
        }
        await AgentRunEvidence.upsertMany(run.id, taskItem.id, evidence);
        const result = {
          id: taskItem.id,
          status: "completed",
          summary: parsed.summary,
          unresolved: parsed.unresolved,
          evidence,
          durationMs: Date.now() - startedAt,
          agent: { id: workerAgent.id, name: workerAgent.name },
        };
        await AgentRunTask.update(taskItem.id, {
          status: "completed",
          resultSummary: result.summary,
          progress: null,
          completedAt: new Date(),
          attempt,
        });
        await emit("task.completed", { taskId: taskItem.id, result });
        return { taskResults: [result], evidence };
      } catch (error) {
        rethrowWorkerInterrupt(error);
        const taskError = isTerminalTaskError(taskController.signal.reason)
          ? taskController.signal.reason
          : error;
        lastError = taskError as Error;
        if (signal?.aborted) throw taskError;
        const priorExecutions =
          (taskError as any)?.code === "TASK_NO_PROGRESS"
            ? await AgentToolExecution.listForTask(run.id, taskItem.id)
            : [];
        const retryNoProgress = shouldRetryNoProgressTask({
          error: taskError,
          attempt,
          maxAttempts: maxWorkerAttempts,
          executions: priorExecutions,
        });
        if (isTerminalTaskError(taskError) && !retryNoProgress) break;
        if (attempt < maxWorkerAttempts) {
          await AgentRunTask.update(taskItem.id, {
            status: "retrying",
            attempt: attempt + 1,
            progress: retryNoProgress
              ? `Continuing ${taskItem.title} from completed tool results`
              : `Retrying ${taskItem.title} with a fresh model call`,
          });
          await emit("task.retrying", {
            taskId: taskItem.id,
            attempt: attempt + 1,
            error: (taskError as Error).message,
          });
        }
      } finally {
        if (taskTimeout) clearTimeout(taskTimeout);
      }
    }
    const failed = {
      id: taskItem.id,
      status: "failed",
      summary: `Could not complete ${taskItem.title}.`,
      error: lastError?.message || "Task failed.",
      evidence: [],
      unresolved: [lastError?.message || "Task failed."],
      durationMs: Date.now() - startedAt,
      agent: { id: workerAgent.id, name: workerAgent.name },
    };
    await AgentRunTask.update(taskItem.id, {
      status: "failed",
      error: failed.error,
      resultSummary: failed.summary,
      progress: null,
      completedAt: new Date(),
    });
    await emit("task.failed", { taskId: taskItem.id, error: failed.error });
    return { taskResults: [failed] };
  };
}

module.exports = {
  createDispatchRouter,
  createScheduleNode,
  createWorkerNode,
};
