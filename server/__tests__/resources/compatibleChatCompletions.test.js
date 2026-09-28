const { ChatOpenAI, ChatOpenAICompletions } = require("@langchain/openai");
const { AIMessage } = require("@langchain/core/messages");
const { createAgent, tool } = require("langchain");
const { z } = require("zod");
const {
  CompatibleChatCompletions,
} = require("../../resources/compatibleChatCompletions");
const {
  reasoningOnlyFallbackMiddleware,
} = require("../../agent-system/modelMiddleware");

function streamedModel(turns, Completion = CompatibleChatCompletions) {
  const completions = new Completion({ model: "mock", apiKey: "mock" });
  const calls = jest.fn();
  completions.completionWithRetry = async () => {
    const deltas = turns[calls.mock.calls.length];
    calls();
    if (!deltas) throw new Error("Unexpected extra model call");
    return (async function* () {
      for (const delta of deltas) {
        yield {
          id: `mock-${calls.mock.calls.length}`,
          choices: [{ index: 0, delta }],
        };
      }
    })();
  };
  return {
    model: new ChatOpenAI({ model: "mock", apiKey: "mock", completions }),
    calls,
  };
}
async function run(
  model,
  {
    tools = [],
    fallback = () => {
      throw new Error("Unexpected fallback");
    },
  } = {}
) {
  const agent = createAgent({
    model,
    tools,
    middleware: [reasoningOnlyFallbackMiddleware(fallback)],
  });
  let state;
  for await (const [mode, data] of await agent.stream(
    { messages: [{ role: "user", content: "test" }] },
    { streamMode: ["messages", "values"] }
  )) {
    if (mode === "values") state = data;
  }
  return state;
}
it("reproduces the reported error with SDK role-less streaming", async () => {
  const { model } = streamedModel(
    [[{ content: "hello" }]],
    ChatOpenAICompletions
  );
  await expect(run(model)).rejects.toThrow(
    "expected AIMessage or Command, got object"
  );
});
it("accepts role-less text chunks through the real agent middleware", async () => {
  const { model } = streamedModel([
    [{ content: "hello" }, { content: " world" }],
  ]);
  const state = await run(model);
  expect(AIMessage.isInstance(state.messages.at(-1))).toBe(true);
  expect(state.messages.at(-1).content).toBe("hello world");
});
it("preserves fragmented tool calls and executes them exactly once", async () => {
  const execute = jest.fn(async ({ value }) => `result ${value}`);
  const lookup = tool(execute, {
    name: "lookup",
    description: "Test lookup",
    schema: z.object({ value: z.string() }),
  });
  const { model, calls } = streamedModel([
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "lookup", arguments: '{"value":' },
          },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] },
    ],
    [{ content: "finished" }],
  ]);
  const state = await run(model, { tools: [lookup] });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0]).toEqual({ value: "test" });
  expect(calls).toHaveBeenCalledTimes(2);
  expect(state.messages.at(-1).content).toBe("finished");
});
it("preserves hidden reasoning so the fallback still runs once", async () => {
  const primary = streamedModel([[{ reasoning_content: "thinking only" }]]);
  const secondary = streamedModel([[{ content: "final answer" }]]);
  const fallback = jest.fn(() => secondary.model);
  const state = await run(primary.model, { fallback });
  expect(fallback).toHaveBeenCalledTimes(1);
  expect(primary.calls).toHaveBeenCalledTimes(1);
  expect(secondary.calls).toHaveBeenCalledTimes(1);
  expect(state.messages.at(-1).content).toBe("final answer");
});
it("preserves explicit roles and normal assistant chunks", () => {
  const model = new CompatibleChatCompletions({
    model: "mock",
    apiKey: "mock",
  });
  const response = { id: "test", choices: [{ index: 0 }] };
  expect(
    model._convertCompletionsDeltaToBaseMessageChunk(
      { role: "user", content: "hello" },
      response
    ).type
  ).toBe("human");
  expect(
    model._convertCompletionsDeltaToBaseMessageChunk(
      { content: "hello" },
      response,
      "user"
    ).type
  ).toBe("human");
  expect(
    AIMessage.isInstance(
      model._convertCompletionsDeltaToBaseMessageChunk(
        { role: "assistant", content: "hello" },
        response
      )
    )
  ).toBe(true);
});
