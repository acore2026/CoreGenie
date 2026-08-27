const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { interrupt } = require("@langchain/langgraph");
const { defineTool, toLangChainTool } = require("./descriptor");
const { resolveAgent } = require("../resources/agents");
const { childRunnableConfig } = require("../agent-system/observability");
const { invokeAgentRuntime } = require("../agent-system/runtimes/invoke");

function createSubagentTool(context, availableAgents = []) {
  const roster = availableAgents
    .map(
      (agent) =>
        `${agent.id}: ${agent.name} — ${agent.description || "No description"}`
    )
    .join("\n");
  const descriptor = defineTool({
    id: "agent.call",
    name: "call_agent",
    description: `Delegate a bounded task to a specialized Agent. Available Agents:\n${roster || "No other Agents are available."}`,
    schema: z.object({
      agent_id: z.number().int().positive(),
      task: z.string().min(1),
    }),
    execute: async ({ agent_id, task }, _toolContext, runnableConfig) => {
      if (context.depth >= 3)
        throw new Error("Maximum subagent depth (3) reached.");
      context.budget.subagentCalls += 1;
      if (context.budget.subagentCalls > 20)
        throw new Error("Maximum subagent calls (20) reached.");
      if (!availableAgents.some((agent) => agent.id === agent_id))
        throw new Error("Requested Agent is not available to this Agent.");
      const child = await resolveAgent(agent_id);
      if (!child) throw new Error("Requested Agent is disabled or missing.");

      const childRunId = runnableConfig?.toolCall?.id || uuidv4();
      await context.emit("subagent.started", {
        childRunId,
        parentRunId: context.run.id,
        depth: context.depth + 1,
        task,
        agent: { id: child.id, name: child.name },
      });
      try {
        const invocation = {
          parentRun: context.run,
          workspace: context.workspace,
          user: context.user,
          agent: child,
          prompt: task,
          checkpointThreadId: `${context.run.checkpointThreadId}:subagent:${childRunId}`,
          emit: context.emit,
          signal: context.signal,
          budget: context.budget,
          depth: context.depth + 1,
          maxLocalToolCalls: 50,
          runnableConfig: childRunnableConfig(runnableConfig, {
            tags: ["subagent"],
            metadata: {
              childAgentId: String(child.id),
              subagentDepth: String(context.depth + 1),
            },
          }),
        };
        let result = await invokeAgentRuntime(invocation);
        if (result.kind === "interrupt") {
          const response = interrupt({
            ...result.interrupt,
            parentTaskId: context.taskId,
            childRunId,
            agent: { id: child.id, name: child.name },
          });
          result = await invokeAgentRuntime({
            ...invocation,
            resume: response,
          });
        }
        if (result.kind === "interrupt")
          throw new Error(
            "The delegated Agent requested input more than once."
          );
        const response = result.text;
        await context.emit("subagent.completed", {
          childRunId,
          parentRunId: context.run.id,
          depth: context.depth + 1,
          task,
          agent: { id: child.id, name: child.name },
          response,
        });
        return response;
      } catch (error) {
        await context.emit("subagent.failed", {
          childRunId,
          parentRunId: context.run.id,
          task,
          agent: { id: child.id, name: child.name },
          error: error.message,
        });
        throw error;
      }
    },
  });
  return toLangChainTool(descriptor, context);
}

module.exports = { createSubagentTool };
