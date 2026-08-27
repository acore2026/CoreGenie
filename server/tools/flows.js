const { z } = require("zod");
const { defineTool, toLangChainTool } = require("./descriptor");
const { AgentFlows } = require("../utils/agentFlows");
const { compileAgentFlow } = require("../agent-system/flows");
const { childRunnableConfig } = require("../agent-system/observability");
const { Command, interrupt } = require("@langchain/langgraph");

function activeFlowTools(context, allowed = null) {
  return AgentFlows.listFlows()
    .filter((flow) => flow.active)
    .filter((flow) => !allowed || allowed.has(`@@flow_${flow.uuid}`))
    .map((summary) => {
      const flow = AgentFlows.loadFlow(summary.uuid);
      const start = flow.config.steps?.find((step) => step.type === "start");
      const shape = Object.fromEntries(
        (start?.config?.variables || [])
          .filter((variable) => variable.name)
          .map((variable) => [variable.name, z.string().optional()])
      );
      const descriptor = defineTool({
        id: `flow.${summary.uuid}`,
        name:
          AgentFlows.sanitizeToolName(summary.name) || `flow_${summary.uuid}`,
        description:
          summary.description || `Execute Agent Flow: ${summary.name}`,
        schema: z.object(shape),
        execute: async (variables, _toolContext, runnableConfig) => {
          const graph = compileAgentFlow(flow, context);
          const config = {
            ...childRunnableConfig(runnableConfig, {
              tags: ["agent-flow"],
              metadata: { flowId: String(summary.uuid) },
            }),
            configurable: {
              thread_id: `${context.run.checkpointThreadId}:flow:${summary.uuid}`,
            },
            signal: context.signal,
          };
          const snapshot = await graph.getState(config);
          let input = { variables };
          if (snapshot.next?.length) {
            const pending = snapshot.tasks
              ?.flatMap((task) => task.interrupts || [])
              .at(0)?.value;
            input = new Command({ resume: interrupt(pending) });
          }
          let state = await graph.invoke(input, config);
          if (state.__interrupt__?.length) {
            const answer = interrupt(state.__interrupt__[0].value);
            state = await graph.invoke(new Command({ resume: answer }), config);
          }
          return (
            state.directOutput ?? {
              success: true,
              results: state.results,
              variables: state.variables,
            }
          );
        },
      });
      return toLangChainTool(descriptor, context);
    });
}

module.exports = { activeFlowTools };
