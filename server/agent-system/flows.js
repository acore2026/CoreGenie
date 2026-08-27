const {
  Annotation,
  StateGraph,
  START,
  END,
  interrupt,
} = require("@langchain/langgraph");
const { FLOW_TYPES } = require("../utils/agentFlows/flowTypes");
const executeApiCall = require("../utils/agentFlows/executors/api-call");
const { createChatModel } = require("../resources/models");
const { resolveAgent } = require("../resources/agents");
const { finalText } = require("./message");
const { safeJsonParse } = require("../utils/http");
const { getCheckpointer } = require("./checkpointer");
const { childRunnableConfig } = require("./observability");

const FlowState = Annotation.Root({
  variables: Annotation({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  results: Annotation({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  directOutput: Annotation({ default: () => null }),
  halted: Annotation({ default: () => false }),
});

function valueAtPath(object, path) {
  const parts = String(path)
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".");
  let value = object;
  for (const part of parts) {
    if (!part) continue;
    if (typeof value === "string") value = safeJsonParse(value, value);
    if (value === null || typeof value !== "object" || !(part in value))
      return undefined;
    value = value[part];
  }
  return typeof value === "object" ? JSON.stringify(value) : value;
}

function replaceVariables(value, variables) {
  if (typeof value === "string")
    return value.replace(/\${([^}]+)}/g, (match, name) => {
      const replacement = valueAtPath(variables, name);
      return replacement === undefined ? match : replacement;
    });
  if (Array.isArray(value))
    return value.map((entry) => replaceVariables(entry, variables));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceVariables(entry, variables),
      ])
    );
  return value;
}

async function executeWebScraping(config, context, runnableConfig = {}) {
  const { CollectorApi } = require("../utils/collectorApi");
  const captureMode = config.captureAs === "querySelector" ? "html" : "text";
  await context.emit("activity.updated", {
    phase: "flow",
    summary: `Reading ${config.url}`,
  });
  const result = await new CollectorApi().getLinkContent(
    config.url,
    captureMode
  );
  if (!result.success || !result.content)
    throw new Error(`Could not read ${config.url}.`);
  let content = result.content;
  if (config.captureAs === "querySelector" && config.querySelector) {
    const cheerio = require("cheerio");
    const $ = cheerio.load(content);
    const matches = $(config.querySelector);
    if (!matches.length)
      throw new Error(`No content matched ${config.querySelector}.`);
    content = matches
      .map((_, element) => $(element).html())
      .get()
      .join("\n");
  }
  if (config.enableSummarization !== false && content.length > 60_000) {
    const response = await createChatModel({
      workspace: context.workspace,
      temperature: 0,
    }).invoke(
      [
        {
          role: "user",
          content: `Summarize this webpage while preserving concrete facts and links:\n\n${content.slice(0, 120_000)}`,
        },
      ],
      childRunnableConfig(runnableConfig, { tags: ["flow-web-summary"] })
    );
    return finalText({ messages: [response] });
  }
  return content;
}

async function executeNativeStep(
  step,
  variables,
  context,
  runnableConfig = {}
) {
  const config = replaceVariables(step.config || {}, variables);
  const flowContext = {
    variables,
    introspect: (summary) =>
      context.emit("activity.updated", { phase: "flow", summary }),
    logger: console.info,
    aibitat: null,
  };

  switch (step.type) {
    case FLOW_TYPES.START.type:
      return Object.fromEntries(
        (config.variables || [])
          .filter((variable) => variable.name)
          .map((variable) => [
            variable.name,
            variables[variable.name] ?? variable.value ?? "",
          ])
      );
    case FLOW_TYPES.API_CALL.type:
      return executeApiCall(config, flowContext);
    case FLOW_TYPES.WEB_SCRAPING.type:
      return executeWebScraping(config, context, runnableConfig);
    case FLOW_TYPES.LLM_INSTRUCTION.type: {
      const response = await createChatModel({
        workspace: context.workspace,
      }).invoke(
        [{ role: "user", content: String(config.instruction || "") }],
        childRunnableConfig(runnableConfig, { tags: ["flow-llm"] })
      );
      return finalText({ messages: [response] });
    }
    case FLOW_TYPES.PREDEFINED_AGENT.type: {
      const child = await resolveAgent(config.agentId);
      if (!child) throw new Error("Flow Agent is missing or disabled.");
      const { invokeAgentRuntime } = require("./runtimes/invoke");
      const result = await invokeAgentRuntime({
        parentRun: context.run,
        workspace: context.workspace,
        user: context.user,
        agent: child,
        prompt: String(config.task || ""),
        checkpointThreadId: `${context.run.checkpointThreadId}:flow-agent:${child.id}:${Date.now()}`,
        emit: context.emit,
        signal: context.signal,
        budget: context.budget,
        depth: context.depth + 1,
        maxLocalToolCalls: 50,
        runnableConfig: childRunnableConfig(runnableConfig, {
          tags: ["flow-agent"],
          metadata: { childAgentId: String(child.id) },
        }),
      });
      return result.text;
    }
    case FLOW_TYPES.REQUEST_USER_INPUT.type:
      return interrupt({
        kind: "input",
        requestId: `flow:${context.run.id}:${Date.now()}`,
        questions: [
          {
            question: String(config.question || "Input required"),
            type: config.kind === "choice" ? "single" : "text",
            options: config.options || [],
          },
        ],
      });
    default:
      throw new Error(`Unsupported Agent Flow step: ${step.type}`);
  }
}

function compileAgentFlow(flow, context) {
  const steps = flow.config?.steps || [];
  if (!steps.length) throw new Error(`Agent Flow ${flow.uuid} has no steps.`);
  const graph = new StateGraph(FlowState);
  steps.forEach((step, index) => {
    const node = `step_${index}`;
    graph.addNode(node, async (state, runnableConfig) => {
      if (state.halted) return {};
      const result = await executeNativeStep(
        step,
        state.variables,
        context,
        runnableConfig
      );
      const key = step.config?.resultVariable || step.config?.responseVariable;
      return {
        variables:
          step.type === FLOW_TYPES.START.type
            ? result
            : key
              ? { [key]: result }
              : {},
        results: [{ step: index, type: step.type, result }],
        directOutput: step.config?.directOutput ? result : state.directOutput,
        halted: Boolean(step.config?.directOutput),
      };
    });
    if (index === 0) graph.addEdge(START, node);
    const next = index + 1 < steps.length ? `step_${index + 1}` : END;
    graph.addConditionalEdges(node, (state) => (state.halted ? END : next));
  });
  return graph.compile({ checkpointer: getCheckpointer() });
}

module.exports = { FlowState, compileAgentFlow, executeNativeStep };
