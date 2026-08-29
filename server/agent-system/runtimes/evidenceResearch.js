const crypto = require("crypto");
const { jsonrepair } = require("jsonrepair");
const { z } = require("zod");
const {
  Annotation,
  Command,
  END,
  Send,
  START,
  StateGraph,
  interrupt,
} = require("@langchain/langgraph");
const { createChatModel } = require("../../resources/models");
const { buildAgentGraph } = require("../graph");
const { contentText, finalText, userContent } = require("../message");
const { getCustomCheckpointer } = require("../checkpointer");
const { childRunnableConfig, withAgentStepTrace } = require("../observability");
const { consumeGraphStream } = require("./stream");
const { recursionLimitFor } = require("../executionLimits");

const MAX_WORKERS_PER_ROUND = 8;
const MAX_CONCURRENT_WORKERS = 4;
const MAX_WORKER_BRANCHES = 20;
const MAX_RESEARCH_ROUNDS = 5;

const workstreamSchema = z.object({
  id: z.string().trim().min(1).max(80),
  objective: z.string().trim().min(1).max(2_000),
  preferredSources: z.array(z.string().trim().min(1)).max(8).default([]),
});

const planSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  useTools: z.boolean().default(true),
  needsInput: z.boolean().default(false),
  question: z.string().trim().max(1_000).nullable().default(null),
  workstreams: z.array(workstreamSchema).min(1).max(MAX_WORKERS_PER_ROUND),
});

const evidenceSchema = z.object({
  kind: z
    .enum(["user", "rag", "memory", "web", "file", "tool", "agent"])
    .default("tool"),
  title: z.string().trim().min(1).max(500),
  uri: z.string().trim().max(4_000).nullable().default(null),
  excerpt: z.string().trim().min(1).max(8_000),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const workerResultSchema = z.object({
  summary: z.string().trim().min(1).max(8_000),
  evidence: z.array(evidenceSchema).max(40).default([]),
  unresolved: z.array(z.string().trim().min(1)).max(20).default([]),
});

const reviewSchema = z.object({
  sufficient: z.boolean(),
  rationale: z.string().trim().min(1).max(4_000),
  gaps: z.array(z.string().trim().min(1)).max(20).default([]),
  needsInput: z.boolean().default(false),
  question: z.string().trim().max(1_000).nullable().default(null),
  followUpWorkstreams: z
    .array(workstreamSchema)
    .max(MAX_WORKERS_PER_ROUND)
    .default([]),
});

function mergeEvidence(current = [], update = []) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of update || []) merged.set(item.id, item);
  return [...merged.values()];
}

const ResearchState = Annotation.Root({
  request: Annotation({ default: () => "" }),
  history: Annotation({ default: () => [] }),
  attachments: Annotation({ default: () => [] }),
  clarification: Annotation({ default: () => "" }),
  plan: Annotation({ default: () => null }),
  workItem: Annotation({ default: () => null }),
  workerResults: Annotation({
    reducer: (current, update) => [...current, ...(update || [])],
    default: () => [],
  }),
  evidence: Annotation({
    reducer: mergeEvidence,
    default: () => [],
  }),
  review: Annotation({ default: () => null }),
  round: Annotation({ default: () => 0 }),
  workersUsed: Annotation({
    reducer: (current, update) => current + Number(update || 0),
    default: () => 0,
  }),
  finalResponse: Annotation({ default: () => "" }),
  sources: Annotation({ default: () => [] }),
});

function parseJsonObject(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^<[^>]+>/, "")
    .replace(/<\/[^>]+>$/, "")
    .trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start)
    throw new Error("Model returned no JSON object.");
  return JSON.parse(jsonrepair(raw.slice(start, end + 1)));
}

function requestDisablesTools(request = "") {
  const text = String(request);
  return (
    /\b(?:do\s+not|don't|without)\s+(?:call(?:ing)?|use|using|invoke|invoking|access(?:ing)?)\s+(?:any\s+)?(?:external\s+)?tools?\b/i.test(
      text
    ) ||
    /(?:不要|不得|无需|不使用|禁止使用|不可使用)[^。；;\n]{0,16}(?:外部)?工具/.test(
      text
    )
  );
}

function evidenceId(item) {
  return `evidence:${crypto
    .createHash("sha256")
    .update(
      [item.kind, item.uri || "", item.title, item.excerpt].join("\u0000")
    )
    .digest("hex")
    .slice(0, 20)}`;
}

function normalizeEvidence(items = [], workItem = null) {
  return items.map((item) => ({
    ...item,
    id: evidenceId(item),
    workstreamId: workItem?.id || null,
    retrievedAt: new Date().toISOString(),
  }));
}

function sourceFromEvidence(item, index) {
  return {
    id: item.id,
    url: item.uri || `evidence://${item.id}`,
    title: item.title || `Evidence ${index + 1}`,
    text: item.excerpt,
    description: item.excerpt.slice(0, 500),
    docSource: item.kind,
    metadata: item.metadata || {},
  };
}

function modelForRole(run, role) {
  const snapshot = run.runtimeSnapshot || {};
  return {
    configured: snapshot.roleModels?.[role] || snapshot.selectedModel || null,
    fallback: snapshot.selectedModel || null,
  };
}

function modelMessages(system, user) {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function invokeStructuredModel({
  run,
  workspace,
  role,
  schema,
  name,
  system,
  user,
  emit,
  runnableConfig,
}) {
  const { configured, fallback } = modelForRole(run, role);
  const candidates = [...new Set([configured, fallback].filter(Boolean))];
  if (!candidates.length) candidates.push(null);
  let lastError;
  for (let index = 0; index < candidates.length; index += 1) {
    const modelName = candidates[index];
    const model = createChatModel({
      workspace,
      model: modelName,
      temperature: 0,
      thinking: run.configuration?.thinking !== false,
    });
    const config = {
      ...childRunnableConfig(runnableConfig, {
        tags: ["evidence-research", `role:${role}`],
        metadata: { role, configuredModel: configured || "workspace-default" },
      }),
      runName: name,
      signal: runnableConfig?.signal,
    };
    try {
      try {
        return await model
          .withStructuredOutput(schema, { name })
          .invoke(modelMessages(system, user), config);
      } catch {
        const jsonSchema = z.toJSONSchema(schema);
        const response = await model.invoke(
          modelMessages(
            `${system}\n\nReturn only JSON matching this schema:\n${JSON.stringify(jsonSchema)}`,
            user
          ),
          config
        );
        return schema.parse(parseJsonObject(contentText(response.content)));
      }
    } catch (error) {
      lastError = error;
      if (index + 1 < candidates.length) {
        await emit("model.fallback", {
          role,
          configuredModel: modelName,
          fallbackModel: candidates[index + 1],
          error: error.message,
        });
      }
    }
  }
  throw lastError || new Error(`Unable to run the ${role} model.`);
}

function workerPrompt(basePrompt, state, toolsDisabled) {
  const sourcePolicy = toolsDisabled
    ? "Tools are disabled for this workstream. Use only evidence supplied directly in the research request. Record supplied text with kind `user` and uri null."
    : "Use the available tools to inspect primary sources, workspace knowledge, memories, or files as needed.";
  return `${basePrompt}\n\nYou are one evidence worker in a larger research graph. Work only on the assigned objective. ${sourcePolicy} Do not write the final user answer. Return one JSON object with keys summary, evidence, and unresolved. Every evidence item must contain kind, title, uri, excerpt, and metadata. Allowed evidence kinds are user, rag, memory, web, file, tool, and agent. Never invent a URI or claim that was not present in a tool result or in user-supplied evidence.\n\n<research_request>\n${state.request}\n</research_request>\n\n<assigned_workstream id="${state.workItem.id}">\n${state.workItem.objective}\nPreferred sources: ${(state.workItem.preferredSources || []).join(", ") || "best available evidence"}\n</assigned_workstream>`;
}

function createResearchGraph(context) {
  const { run, workspace, user, agent, emit, signal, runnableConfig, onToken } =
    context;
  const basePrompt =
    run.runtimeSnapshot?.systemPrompt || agent.systemPrompt || "";
  const sharedBudget = context.budget || {
    calls: 0,
    subagentCalls: 0,
    actionTail: Promise.resolve(),
  };

  const plan = async (state) =>
    withAgentStepTrace(
      "plan-research",
      {
        input: { request: state.request, clarification: state.clarification },
        metadata: { round: state.round },
      },
      async () => {
        await emit("activity.updated", {
          phase: "planning",
          summary:
            state.round > 0
              ? "Updating the research plan with new evidence"
              : "Breaking the request into evidence questions",
        });
        return {
          plan: await invokeStructuredModel({
            run,
            workspace,
            role: "planner",
            schema: planSchema,
            name: "plan-research",
            system: `${basePrompt}\n\nYou are the research planner. Produce a compact evidence-gathering plan with independent workstreams. Set useTools to false when the user requires using only supplied evidence or prohibits tools; otherwise set it to true. Ask for user input only when proceeding would materially risk answering the wrong question.`,
            user: `Request:\n${state.request}\n\nClarification:\n${state.clarification || "None"}`,
            emit,
            runnableConfig,
          }),
        };
      }
    );

  const researchWorker = async (state, config) =>
    withAgentStepTrace(
      "gather-evidence",
      {
        input: {
          workstreamId: state.workItem.id,
          objective: state.workItem.objective,
        },
        metadata: { workstreamId: state.workItem.id, round: state.round },
      },
      async () => {
        const toolsDisabled =
          requestDisablesTools(state.request) || state.plan?.useTools === false;
        await emit("activity.updated", {
          phase: "research",
          summary: `Researching: ${state.workItem.objective.slice(0, 140)}`,
        });
        const workerAgent = await buildAgentGraph({
          run,
          workspace,
          user,
          agent,
          emit,
          signal,
          budget: sharedBudget,
          depth: context.depth || 0,
          maxLocalToolCalls: context.maxLocalToolCalls || 500,
          systemPromptOverride: workerPrompt(basePrompt, state, toolsDisabled),
          checkpointerOverride: getCustomCheckpointer(),
          excludeToolIds: ["user.ask"],
          disableTools: toolsDisabled,
        });
        const workerState = await workerAgent.invoke(
          {
            messages: [
              {
                role: "user",
                content: userContent(
                  `Research this objective and return the required evidence JSON: ${state.workItem.objective}`,
                  state.attachments
                ),
              },
            ],
          },
          {
            ...childRunnableConfig(config, {
              tags: ["evidence-worker"],
              metadata: {
                workstreamId: state.workItem.id,
                researchRound: String(state.round),
              },
            }),
            configurable: {
              thread_id: `${run.checkpointThreadId}:worker:${state.round}:${state.workItem.id}`,
            },
            recursionLimit: recursionLimitFor(run, 1_100),
            signal,
          }
        );
        let parsed;
        try {
          parsed = workerResultSchema.parse(
            parseJsonObject(finalText(workerState))
          );
        } catch (error) {
          parsed = {
            summary: finalText(workerState) || "Worker returned no summary.",
            evidence: [],
            unresolved: [
              `Could not parse structured evidence: ${error.message}`,
            ],
          };
        }
        return {
          evidence: normalizeEvidence(parsed.evidence, state.workItem),
          workerResults: [
            {
              ...parsed,
              workstreamId: state.workItem.id,
              objective: state.workItem.objective,
            },
          ],
          workersUsed: 1,
        };
      }
    );

  const aggregate = async (state) => {
    await emit("activity.updated", {
      phase: "reasoning",
      summary: `Comparing ${state.evidence.length} evidence items across ${state.workerResults.length} workstreams`,
    });
    return {};
  };

  const review = async (state) =>
    withAgentStepTrace(
      "review-evidence",
      {
        input: {
          request: state.request,
          evidenceCount: state.evidence.length,
          workerCount: state.workerResults.length,
        },
        metadata: { round: state.round },
      },
      async () => {
        await emit("activity.updated", {
          phase: "review",
          summary: "Checking evidence coverage, conflicts, and missing facts",
        });
        const reviewResult = await invokeStructuredModel({
          run,
          workspace,
          role: "reviewer",
          schema: reviewSchema,
          name: "review-evidence",
          system: `${basePrompt}\n\nYou review research evidence for coverage, source quality, contradictions, and whether the final answer can be supported. Request more work only for material gaps.`,
          user: `Request:\n${state.request}\n\nEvidence:\n${JSON.stringify(state.evidence)}\n\nWorker summaries:\n${JSON.stringify(state.workerResults)}`,
          emit,
          runnableConfig,
        });
        return { review: reviewResult };
      }
    );

  const requestInput = async (state) => {
    const question =
      state.plan?.question ||
      state.review?.question ||
      "What additional detail should the research use?";
    const response = interrupt({
      kind: "input",
      requestId: `research:${run.id}:${state.round}`,
      questions: [{ question, type: "text", options: [] }],
    });
    const answers = Array.isArray(response?.answers)
      ? response.answers
          .map((answer) => answer?.answer ?? answer?.value ?? answer)
          .filter(Boolean)
          .join("\n")
      : "";
    return {
      clarification: response?.skipped
        ? "User skipped clarification."
        : answers,
      round: state.round + 1,
    };
  };

  const revisePlan = async (state) => ({
    plan: {
      summary: `Follow-up research for round ${state.round + 1}`,
      needsInput: false,
      question: null,
      workstreams: state.review?.followUpWorkstreams?.length
        ? state.review.followUpWorkstreams
        : (state.review?.gaps || [])
            .slice(0, MAX_WORKERS_PER_ROUND)
            .map((gap, index) => ({
              id: `follow-up-${state.round + 1}-${index + 1}`,
              objective: gap,
              preferredSources: [],
            })),
    },
    round: state.round + 1,
  });

  const synthesize = async (state) =>
    withAgentStepTrace(
      "generate-cited-answer",
      {
        input: {
          request: state.request,
          evidenceCount: state.evidence.length,
          review: state.review,
        },
        metadata: { round: state.round },
      },
      async () => {
        await emit("activity.updated", {
          phase: "writing",
          summary: `Writing the answer from ${state.evidence.length} verified evidence items`,
        });
        const evidence = state.evidence.map((item, index) => ({
          citation: `E${index + 1}`,
          ...item,
        }));
        const { configured, fallback } = modelForRole(run, "synthesizer");
        const candidates = [...new Set([configured, fallback].filter(Boolean))];
        if (!candidates.length) candidates.push(null);
        let text = "";
        let lastError;
        for (let index = 0; index < candidates.length; index += 1) {
          const modelName = candidates[index];
          const model = createChatModel({
            workspace,
            model: modelName,
            temperature: 0.2,
            thinking: run.configuration?.thinking !== false,
          });
          try {
            const stream = await model.stream(
              modelMessages(
                `${basePrompt}\n\nWrite the final answer using only supported evidence below. Cite factual claims inline as [E1], [E2], and so on. Explain uncertainty and conflicts. Never expose internal JSON or planning text.`,
                `Request:\n${state.request}\n\nReview:\n${JSON.stringify(state.review)}\n\nEvidence:\n${JSON.stringify(evidence)}`
              ),
              {
                ...childRunnableConfig(runnableConfig, {
                  tags: ["evidence-research", "role:synthesizer"],
                  metadata: { role: "synthesizer" },
                }),
                runName: "generate-cited-answer",
                signal,
              }
            );
            for await (const chunk of stream) {
              const token = contentText(chunk.content);
              if (!token) continue;
              text += token;
              await onToken(token);
            }
            break;
          } catch (error) {
            lastError = error;
            if (text) throw error;
            if (index + 1 < candidates.length)
              await emit("model.fallback", {
                role: "synthesizer",
                configuredModel: modelName,
                fallbackModel: candidates[index + 1],
                error: error.message,
              });
          }
        }
        if (!text && lastError) throw lastError;
        if (!text.trim())
          text = state.evidence.length
            ? "I gathered evidence but could not synthesize a reliable final response."
            : "I could not find sufficient evidence to answer this request reliably.";
        return {
          finalResponse: text,
          sources: evidence.map(sourceFromEvidence),
        };
      }
    );

  const dispatchWorkers = (state) => {
    if (state.plan?.needsInput) return "request_input";
    const remaining = Math.max(MAX_WORKER_BRANCHES - state.workersUsed, 0);
    const parallelLimit =
      run.configuration?.approvalMode === "ask" ? 1 : MAX_CONCURRENT_WORKERS;
    const workstreams = (state.plan?.workstreams || []).slice(
      0,
      Math.min(remaining, MAX_WORKERS_PER_ROUND, parallelLimit)
    );
    if (!workstreams.length) return "synthesize";
    return workstreams.map(
      (workItem) =>
        new Send("research_worker", {
          ...state,
          workItem,
        })
    );
  };

  const afterReview = (state) => {
    if (state.review?.sufficient) return "synthesize";
    if (
      state.round >= MAX_RESEARCH_ROUNDS - 1 ||
      state.workersUsed >= MAX_WORKER_BRANCHES
    )
      return "synthesize";
    if (state.review?.needsInput) return "request_input";
    return "revise_plan";
  };

  return new StateGraph(ResearchState)
    .addNode("plan_research", plan)
    .addNode("research_worker", researchWorker)
    .addNode("aggregate_evidence", aggregate)
    .addNode("review_evidence", review)
    .addNode("request_input", requestInput)
    .addNode("revise_plan", revisePlan)
    .addNode("synthesize", synthesize)
    .addEdge(START, "plan_research")
    .addConditionalEdges("plan_research", dispatchWorkers)
    .addEdge("research_worker", "aggregate_evidence")
    .addEdge("aggregate_evidence", "review_evidence")
    .addConditionalEdges("review_evidence", afterReview)
    .addEdge("request_input", "plan_research")
    .addConditionalEdges("revise_plan", dispatchWorkers)
    .addEdge("synthesize", END)
    .compile({ checkpointer: getCustomCheckpointer() });
}

async function executeSegment(context) {
  const { run, history, signal, runnableConfig } = context;
  const graph = createResearchGraph(context);
  const resume = run.configuration?.resume || null;
  const graphInput = run.configuration?.recover
    ? null
    : resume
      ? new Command({ resume })
      : {
          request: run.prompt,
          history,
          attachments: run.attachments || [],
          round: 0,
          workersUsed: 0,
          evidence: [],
          workerResults: [],
        };
  const graphRun = await graph.stream(graphInput, {
    ...runnableConfig,
    streamMode: ["values"],
    configurable: { thread_id: run.checkpointThreadId },
    recursionLimit: recursionLimitFor(
      run,
      Math.min((run.configuration?.maxToolCalls || 2_500) * 2 + 100, 5_500)
    ),
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
  };
}

module.exports = {
  MAX_CONCURRENT_WORKERS,
  MAX_RESEARCH_ROUNDS,
  MAX_WORKER_BRANCHES,
  MAX_WORKERS_PER_ROUND,
  ResearchState,
  createResearchGraph,
  evidenceSchema,
  executeSegment,
  mergeEvidence,
  normalizeEvidence,
  parseJsonObject,
  requestDisablesTools,
  sourceFromEvidence,
};
