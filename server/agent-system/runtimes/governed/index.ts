const { Command, END, START, StateGraph } = require("@langchain/langgraph");
const { recursionLimitFor } = require("../../executionLimits");
const { getCheckpointer } = require("../../checkpointer");
const { consumeGraphStream } = require("../stream");
const types = require("./types.ts");
const grounding = require("./grounding.ts");
const workflows = require("./workflows.ts");
const planning = require("./planning.ts");
const { createPrepareContextNode } = require("./nodes/prepareContext.ts");
const {
  createControllerNode,
  createRequestInputNode,
} = require("./nodes/controller.ts");
const {
  createDispatchRouter,
  createScheduleNode,
  createWorkerNode,
} = require("./nodes/worker.ts");
const {
  afterReview,
  createApplyRevisionNode,
  createReviewNode,
  createSynthesizeNode,
} = require("./nodes/reviewAndSynthesize.ts");

type GovernedContext = import("./types.ts").GovernedContext;
type GovernedStateValue = import("./types.ts").GovernedStateValue;

async function createGovernedGraph(context: GovernedContext) {
  const { run, agent } = context;
  const basePrompt =
    run.runtimeSnapshot?.systemPrompt || agent.systemPrompt || "";
  const sharedBudget = context.budget || {
    calls: 0,
    subagentCalls: 0,
    actionTail: Promise.resolve(),
    operationCounts: new Map(),
  };
  if (!sharedBudget.activatedSkills) sharedBudget.activatedSkills = new Map();
  const activatedSkillScope =
    context.activatedSkillScope || sharedBudget.activatedSkills;

  const prepareContext = createPrepareContextNode(context);
  const controller = createControllerNode(context, {
    basePrompt,
    sharedBudget,
    activatedSkillScope,
  });
  const requestInput = createRequestInputNode(context);
  const schedule = createScheduleNode(context);
  const dispatch = createDispatchRouter();
  const worker = createWorkerNode(context, {
    basePrompt,
    sharedBudget,
    activatedSkillScope,
  });
  const review = createReviewNode(context, { basePrompt });
  const applyRevision = createApplyRevisionNode(context);
  const synthesize = createSynthesizeNode(context, { basePrompt });

  const routeControl = (state: GovernedStateValue) => {
    const kind = state.control?.kind as string | undefined;
    if (kind === "input") return "request_input";
    if (kind && ["skill_activated", "retry_planning"].includes(kind))
      return "controller";
    if (kind === "plan") return "schedule";
    return END;
  };

  return new StateGraph(types.GovernedState)
    .addNode("prepare_context", prepareContext)
    .addNode("controller", controller)
    .addNode("request_input", requestInput)
    .addNode("schedule", schedule)
    .addNode("worker", worker)
    .addNode("review_results", review)
    .addNode("apply_revision", applyRevision)
    .addNode("synthesize", synthesize)
    .addEdge(START, "prepare_context")
    .addEdge("prepare_context", "controller")
    .addConditionalEdges("controller", routeControl)
    .addEdge("request_input", "controller")
    .addConditionalEdges("schedule", dispatch)
    .addEdge("worker", "schedule")
    .addConditionalEdges("review_results", afterReview)
    .addEdge("apply_revision", "schedule")
    .addEdge("synthesize", END)
    .compile({ checkpointer: await getCheckpointer() });
}

async function executeSegment(context: GovernedContext) {
  const { run, history, signal, runnableConfig } = context;
  const graph = await createGovernedGraph(context);
  const resume = run.configuration?.resume || null;
  const graphInput = run.configuration?.recover
    ? null
    : resume
      ? new Command({ resume })
      : {
          request: run.prompt,
          history,
          attachments: run.attachments || [],
          controllerAttachments: [],
          reviewRound: 0,
          taskResults: [],
          evidence: [],
          contextItems: [],
          activatedSkills: context.inheritedSkills || [],
          planningFeedback: "",
          planningAttempts: 0,
        };
  const graphRun = await graph.stream(graphInput, {
    ...runnableConfig,
    streamMode: ["values"],
    configurable: { thread_id: run.checkpointThreadId },
    recursionLimit: recursionLimitFor(run, 800),
    maxConcurrency: types.DEFAULTS.maxConcurrency,
    signal,
  });
  const finalState = await consumeGraphStream(graphRun, async () => null);
  const pendingInterrupt = finalState?.__interrupt__?.[0]?.value;
  if (pendingInterrupt)
    return { kind: "interrupt", interrupt: pendingInterrupt, sources: [] };
  return {
    kind: "completed",
    text: finalState?.finalResponse || "",
    sources: finalState?.sources || [],
    partial: finalState?.review?.status === "partial",
  };
}

module.exports = {
  DEFAULTS: types.DEFAULTS,
  GovernedState: types.GovernedState,
  mergeById: types.mergeById,
  taskSchema: types.taskSchema,
  ...grounding,
  ...workflows,
  ...planning,
  createGovernedGraph,
  executeSegment,
};
