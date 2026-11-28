const { interrupt } = require("@langchain/langgraph");
const { AgentRunTask } = require("../../../../models/agentRunTask");
const { agentListForPrompt } = require("../../../../resources/agents");
const { createChatModel } = require("../../../../resources/models");
const {
  legacySelectionAllows,
  normalizeToolId,
  toolRegistry,
  visibleToolDescriptorsForAgent,
} = require("../../../../tools");
const {
  activatedSkillSnapshot,
  activatedSkillsPrompt,
  restoreActivatedSkills,
} = require("../../../activatedSkills");
const {
  allowedToolIds: skillAllowedToolIds,
  availableSkills,
  skillCatalogPrompt,
} = require("../../../../agent-skills/registry");
const {
  childRunnableConfig,
  withAgentStepTrace,
} = require("../../../observability");
const {
  activateSkillBeforePlanning,
  activateSkillControlTool,
  askUserTool,
  contextPrompt,
  controllerDecisionWithFallback,
  controllerDirectActionsEnabled,
  delegatedControllerActionPlan,
  descriptorsForActivatedSkills,
  modelMessages,
  normalizeControllerAction,
  planTool,
  planValidationRetry,
  roleModel,
  skillToolRestrictionsEnabled,
  usedContextSources,
  validatePlan,
} = require("../planning.ts");
const {
  classify3gppRequest,
  execute3gppMarkdownConversion,
  executeQuick3gppLookup,
  is3gppMarkdownConversionAgent,
  knowledgeToolGuidance,
  normalized3gppLookupPlan,
  parse3gppConversionRequest,
} = require("../workflows.ts");

type GovernedContext = import("../types.ts").GovernedContext;
type GovernedStateValue = import("../types.ts").GovernedStateValue;

function createControllerNode(
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
  const { run, workspace, user, agent, emit, signal, runnableConfig, onToken } =
    context;

  return async (state: GovernedStateValue) =>
    withAgentStepTrace(
      "govern-request",
      { input: { request: state.request }, metadata: { role: "controller" } },
      async () => {
        if (run.mode === "query" && !state.contextItems.length) {
          const response =
            workspace.queryRefusalResponse ||
            "There is no relevant information in this workspace to answer your query.";
          await onToken(response);
          return { control: { kind: "direct" }, finalResponse: response };
        }
        await emit("activity.updated", {
          phase: "planning",
          summary: `Determining the best approach for ${state.request.replace(/\s+/g, " ").slice(0, 120)}`,
          summaryKey: "determining_approach",
          summaryArgs: {
            request: state.request.replace(/\s+/g, " ").slice(0, 120),
          },
        });
        const conversionArgs = is3gppMarkdownConversionAgent(agent)
          ? parse3gppConversionRequest(state.request, run.attachments)
          : null;
        if (conversionArgs) {
          await emit("request.classified", {
            kind: "3gpp_markdown_conversion",
            execution: "deterministic",
          });
          const converted = await execute3gppMarkdownConversion({
            args: conversionArgs,
            run,
            workspace,
            user,
            agent,
            emit,
            signal,
            budget: sharedBudget,
            activatedSkillScope,
          });
          await onToken(converted.text);
          return {
            control: { kind: "direct", streamed: true },
            finalResponse: converted.text,
            sources: converted.sources,
            review: converted.partial ? { status: "partial" } : null,
          };
        }
        const agents = await agentListForPrompt(agent.id);
        const allControllerToolDescriptors = visibleToolDescriptorsForAgent(
          agent,
          {
            allowActions:
              !["query", "chat"].includes(run.mode) && run.source !== "embed",
          }
        );
        await restoreActivatedSkills(
          state.activatedSkills,
          workspace,
          activatedSkillScope,
          user?.id ?? run?.user_id
        );
        const controllerToolDescriptors = descriptorsForActivatedSkills(
          allControllerToolDescriptors,
          state.activatedSkills,
          skillToolRestrictionsEnabled(run)
        );
        const controllerVisibleToolIds = new Set<string>(
          controllerToolDescriptors.map(
            (descriptor: { id: string }) => descriptor.id
          )
        );
        const knowledgeGuidance = knowledgeToolGuidance(
          controllerVisibleToolIds
        );
        const skills = await availableSkills(agent, workspace, {
          userId: user?.id ?? run?.user_id,
        });
        const activatedNames = new Set(
          state.activatedSkills.map((skill) => skill.name)
        );
        const selectableSkills = skills.filter(
          (skill: { name: string }) => !activatedNames.has(skill.name)
        );
        const currentSkillCatalog = await skillCatalogPrompt(
          agent,
          workspace,
          selectableSkills,
          {
            visibleToolIds: controllerVisibleToolIds,
            enforceAllowedTools: skillToolRestrictionsEnabled(run),
          }
        );
        const activatedSkillContext = activatedSkillsPrompt(
          state.activatedSkills,
          controllerVisibleToolIds
        );
        const lookupSkill = skills.find(
          (skill: { name: string }) => skill.name === "3gpp-lookup"
        );
        if (
          lookupSkill &&
          classify3gppRequest(state.request) === "3gpp_fact_lookup"
        ) {
          await emit("request.classified", {
            kind: "3gpp_fact_lookup",
            skill: lookupSkill.name,
            execution: "deterministic",
          });
          const quickResult = await executeQuick3gppLookup({
            request: state.request,
            run,
            workspace,
            user,
            agent,
            emit,
            signal,
            budget: sharedBudget,
            activatedSkillScope,
          });
          if (quickResult) {
            await onToken(quickResult.text);
            return {
              control: { kind: "direct", streamed: true },
              finalResponse: quickResult.text,
              sources: quickResult.sources,
            };
          }
          const configuredTools = Array.isArray(agent?.tools)
            ? new Set(agent.tools)
            : null;
          const lookupSnapshot = activatedSkillScope.get(lookupSkill.name)
            ? activatedSkillSnapshot(activatedSkillScope.get(lookupSkill.name))
            : null;
          const lookupToolIds = new Set<string>();
          const candidateLookupTools: string[] = skillToolRestrictionsEnabled(
            run
          )
            ? skillAllowedToolIds(lookupSkill)
            : [...controllerVisibleToolIds];
          for (const toolId of candidateLookupTools) {
            const descriptor = toolRegistry.get(normalizeToolId(toolId));
            if (
              descriptor &&
              (descriptor.id.startsWith("skill.") ||
                legacySelectionAllows(configuredTools, descriptor))
            )
              lookupToolIds.add(descriptor.id);
          }
          const plan = validatePlan(
            normalized3gppLookupPlan(state.request, lookupToolIds),
            {
              run,
              agent,
              availableAgents: agents,
              activatedSkills: lookupSnapshot ? [lookupSnapshot] : [],
            }
          );
          await AgentRunTask.upsertPlan(run.id, plan.tasks);
          await emit("request.classified", {
            kind: "3gpp_fact_lookup",
            skill: lookupSkill.name,
          });
          await emit("plan.created", {
            goal: plan.goal,
            tasks: plan.tasks,
            reviewRound: state.reviewRound,
          });
          for (const taskItem of plan.tasks)
            await emit("task.created", { task: taskItem });
          return {
            control: { kind: "plan" },
            plan,
            activatedSkills: lookupSnapshot ? [lookupSnapshot] : [],
          };
        }
        const toolList = controllerToolDescriptors
          .map(
            (item: any) =>
              `${item.id} (${item.effect || (item.action ? "write" : "read")}): ${item.description}`
          )
          .join("\n");
        const agentList = agents
          .map(
            (item: any) =>
              `${item.id}: ${item.name} — ${item.description || ""}`
          )
          .join("\n");
        const createControlModel = (thinking: boolean) =>
          createChatModel({
            workspace,
            model: roleModel(run, "controller"),
            temperature: run.configuration?.temperature ?? 0.2,
            thinking,
          }).bindTools(
            [
              ...(selectableSkills.length
                ? [activateSkillControlTool(selectableSkills)]
                : []),
              planTool(),
              askUserTool(),
            ],
            { parallel_tool_calls: false }
          );
        const directActionGuidance = controllerDirectActionsEnabled()
          ? ""
          : " The controller API exposes only activate_skill, create_plan, and ask_user. The execution tools listed below belong to workers and cannot be called by the controller. When any execution tool is needed, call create_plan and put its exact ID in a worker task; never emit an execution-tool call directly.";
        const messages = modelMessages(
          `${basePrompt}${currentSkillCatalog ? `\n\n${currentSkillCatalog}` : ""}${activatedSkillContext ? `\n\n${activatedSkillContext}` : ""}\n\nYou are the controller for a governed Agent runtime. Before creating a plan, call activate_skill for every relevant available Skill whose full instructions are not already present above. Skill activation is a pre-planning control action: never include skill.activate or a Skill activation/bootstrap task in create_plan. After all relevant Skills are activated, create the actual work plan from their complete instructions. Answer ordinary questions directly. Call create_plan only when tools, independent work, delegation, or verification are genuinely useful. Call ask_user only when a missing answer materially changes the work. Every ask_user call must contain exactly three concise, mutually exclusive choices with the recommended choice first; the client supplies the fourth custom-answer option and notes field. Never combine normal answer text with a control tool call. Plans must contain concrete evidence or action tasks, not a final-answer task. Give each worker the smallest relevant allowedToolIds set. An empty allowedToolIds list means that worker receives no tools. When the user requests a list or named fields, make the task that reads or creates the dataset require those complete rows and fields in its worker summary; storing them only in an artifact does not satisfy the request. A task that must create, update, save, or publish an artifact must set writeIntent=true and include the exact write-capable tool. A read-only task must return its analysis in the worker JSON result; never tell it to complete, write, or update a report, ledger, manifest, Markdown file, or other artifact. When the user explicitly limits the request to uploaded files, use only filesystem and document-processing tools; exclude Workspace knowledge, memory, and public-web tools unless the user asks for them. Worker tools below are the complete tool boundary for this run: refer to them only inside create_plan.allowedToolIds, use only those exact IDs, and never invent or infer another tool.${directActionGuidance} ${knowledgeGuidance} For a long Skill workflow, split discovery and manifest creation, acquisition and processing, validation, and final publication into dependency tasks; allow a final-report publication tool only when it appears in Available tools, and only in the final task. For read-only requests, exclude unrelated state-changing tools, but retain Skill-declared execution or file tools required to create the workflow's cache and requested artifacts. Direct answers using context evidence must cite it as [C1], [C2], and so on.${state.planningFeedback ? `\n\nPrevious planning attempt was rejected: ${state.planningFeedback}` : ""}\n\nWorker tools for create_plan (not controller-callable):\n${toolList || "None"}\n\nAvailable specialist Agents:\n${agentList || "None"}`,
          state,
          `${state.request}${state.clarification ? `\n\nUser clarification:\n${state.clarification}` : ""}${contextPrompt(state.contextItems)}`,
          state.controllerAttachments
        );
        const primaryStreamOptions = {
          ...childRunnableConfig(runnableConfig, {
            tags: ["governed-agent", "role:controller"],
            metadata: { role: "controller" },
          }),
          runName: "govern-request",
          signal,
        };
        const controllerThinking =
          run.configuration?.thinking ??
          run.runtimeSnapshot?.runtimeConfig?.thinking ??
          true;
        const decision = await controllerDecisionWithFallback({
          primaryModel: createControlModel(controllerThinking !== false),
          createFallbackModel: () => createControlModel(false),
          messages,
          onToken,
          emit,
          primaryStreamOptions,
          fallbackStreamOptions: {
            ...childRunnableConfig(runnableConfig, {
              tags: [
                "governed-agent",
                "role:controller",
                "fallback:thinking-disabled",
              ],
              metadata: {
                role: "controller",
                fallbackReason: "empty_visible_response",
              },
            }),
            runName: "govern-request-fallback",
            signal,
          },
        });
        const { calls, response, streamedDirect } = decision;
        if (!calls.length) {
          if (!response.trim())
            throw new Error(
              "The controller returned no visible response after retrying with thinking disabled."
            );
          return {
            control: { kind: "direct", streamed: streamedDirect },
            finalResponse: response,
            sources: usedContextSources(response, state.contextItems),
          };
        }
        const call = calls[0];
        if (call.name === "activate_skill") {
          if (activatedNames.has(call.args?.name))
            return {
              control: { kind: "retry_planning" },
              planningFeedback: `Skill "${call.args?.name}" is already activated. Create the actual work plan now.`,
              planningAttempts: state.planningAttempts + 1,
            };
          await emit("activity.updated", {
            phase: "skill",
            summary: `正在加载 ${call.args?.name} 的说明`,
          });
          const snapshot = await activateSkillBeforePlanning({
            name: call.args?.name,
            skills,
            run,
            workspace,
            user,
            agent,
            emit,
            signal,
            budget: sharedBudget,
            visibleToolIds: new Set(
              allControllerToolDescriptors.map(
                (descriptor: { id: string }) => descriptor.id
              )
            ),
            activatedSkillScope,
          });
          await emit("activity.updated", {
            phase: "planning",
            summary: `${snapshot.name} 已加载，正在制定任务计划`,
          });
          return {
            control: { kind: "skill_activated" },
            activatedSkills: [snapshot],
            planningFeedback: "",
          };
        }
        if (call.name === "ask_user")
          return {
            control: {
              kind: "input",
              question: call.args?.question,
              choices: call.args?.choices || [],
            },
          };
        let rawPlan = call.args;
        if (call.name !== "create_plan") {
          const normalizedAction = normalizeControllerAction(
            call,
            controllerToolDescriptors,
            state.request
          );
          if (!normalizedAction)
            throw new Error(`Unsupported controller action: ${call.name}`);
          if (!controllerDirectActionsEnabled()) {
            const reason = `Direct controller action "${normalizedAction.descriptor.id}" is disabled. Create a normal work plan and let the worker choose among its inherited tools.`;
            await emit("plan.rejected", { reason });
            if (state.planningAttempts < 1)
              return {
                control: { kind: "retry_planning" },
                planningFeedback: reason,
                planningAttempts: state.planningAttempts + 1,
              };
            rawPlan = delegatedControllerActionPlan({
              call,
              descriptor: normalizedAction.descriptor,
              descriptors: controllerToolDescriptors,
              request: state.request,
              hasAvailableAgents: agents.length > 0,
              agentTools: agent.tools,
            });
            await emit("controller.action_delegated", {
              requestedAction: call.name,
              toolId: normalizedAction.descriptor.id,
              reason,
            });
          } else {
            await emit("controller.action_normalized", {
              requestedAction: call.name,
              toolId: normalizedAction.descriptor.id,
            });
            rawPlan = normalizedAction.plan;
          }
        }
        let plan;
        try {
          plan = validatePlan(rawPlan, {
            run,
            agent,
            availableAgents: agents,
            activatedSkills: state.activatedSkills,
          });
        } catch (error) {
          const retry = planValidationRetry(error, state.planningAttempts);
          await emit("plan.rejected", { reason: (error as Error).message });
          if (retry) return retry;
          throw error;
        }
        await AgentRunTask.upsertPlan(run.id, plan.tasks);
        await emit("plan.created", {
          goal: plan.goal,
          tasks: plan.tasks,
          reviewRound: state.reviewRound,
        });
        for (const taskItem of plan.tasks)
          await emit("task.created", { task: taskItem });
        return {
          control: { kind: "plan" },
          plan,
          planningFeedback: "",
        };
      }
    );
}

function createRequestInputNode(context: GovernedContext) {
  const { run } = context;
  return async (state: GovernedStateValue) => {
    const response = interrupt({
      kind: "input",
      requestId: `${run.id}:controller-input:${state.reviewRound}`,
      questions: [
        {
          kind: "choice",
          question:
            (state.control?.question as string) || "What should the Agent use?",
          options: (state.control?.choices as string[]) || [],
          multiSelect: false,
          allowOther: true,
        },
      ],
    });
    const answers = Array.isArray(response?.answers)
      ? response.answers
          .map((answer: any) => answer?.answer ?? answer?.value ?? answer)
          .filter(Boolean)
          .join("\n")
      : "";
    return {
      clarification: response?.skipped
        ? "User skipped this question."
        : answers,
      control: null,
    };
  };
}

module.exports = {
  createControllerNode,
  createRequestInputNode,
};
