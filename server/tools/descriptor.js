const { tool } = require("@langchain/core/tools");
const { v4: uuidv4 } = require("uuid");
const { AgentToolExecution } = require("../models/agentToolExecution");
const { isGraphBubbleUp } = require("@langchain/langgraph");

function defineTool({
  id,
  name = id,
  description,
  schema,
  execute,
  action = true,
}) {
  if (!id || !description || !schema || typeof execute !== "function")
    throw new Error(
      "Tool descriptors require id, description, schema, and execute."
    );
  return Object.freeze({ id, name, description, schema, execute, action });
}

function toLangChainTool(descriptor, context) {
  return tool(
    async (args, runnableConfig) => {
      const callId = runnableConfig?.toolCall?.id || uuidv4();
      const existing = await AgentToolExecution.get(context.run.id, callId);
      if (existing?.status === "completed")
        return typeof existing.result === "string"
          ? existing.result
          : JSON.stringify(existing.result);
      context.consumeToolCall();
      await AgentToolExecution.begin({
        runId: context.run.id,
        callId,
        toolId: descriptor.id,
        agentId: context.agent?.id,
        args,
      });
      await context.emit("tool.started", {
        callId,
        toolId: descriptor.id,
        summary: descriptor.description,
        arguments: args,
      });
      await context.emit("activity.updated", {
        phase: "tool",
        summary: `${descriptor.description} ${JSON.stringify(args).slice(0, 160)}`,
      });

      try {
        const execute = () => descriptor.execute(args, context, runnableConfig);
        const result = descriptor.action
          ? await context.runAction(execute)
          : await execute();
        await AgentToolExecution.finish(context.run.id, callId, { result });
        await context.emit("tool.completed", {
          callId,
          toolId: descriptor.id,
          result,
        });
        await context.emit("activity.updated", {
          phase: "reasoning",
          summary: `Using the ${descriptor.name} result to continue the request`,
        });
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (error) {
        if (isGraphBubbleUp(error)) throw error;
        await AgentToolExecution.finish(context.run.id, callId, {
          error: error.message,
        });
        await context.emit("tool.failed", {
          callId,
          toolId: descriptor.id,
          error: error.message,
        });
        throw error;
      }
    },
    {
      name: descriptor.name,
      description: descriptor.description,
      schema: descriptor.schema,
    }
  );
}

module.exports = { defineTool, toLangChainTool };
