/* eslint-env jest, node */
const { createAgent } = require("langchain");
const { FakeListChatModel } = require("@langchain/core/utils/testing");
const {
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const { consumeGraphStream } = require("../../agent-system/executor");

describe("native Agent graph streaming", () => {
  it("streams model deltas and retains the final graph state", async () => {
    const graph = createAgent({
      model: new FakeListChatModel({ responses: ["hello"] }),
      tools: [],
    });
    const stream = await graph.stream(
      { messages: [{ role: "user", content: "hi" }] },
      { streamMode: ["messages", "values"] }
    );
    let text = "";
    const state = await consumeGraphStream(stream, async (token) => {
      text += token;
    });

    expect(text).toBe("hello");
    expect(state.messages.at(-1).content).toBe("hello");
  });

  it("does not leak user or tool results into visible response deltas", async () => {
    async function* graphStream() {
      yield [
        "messages",
        [new HumanMessage("question"), { langgraph_node: "model" }],
      ];
      yield [
        "messages",
        [
          new ToolMessage({
            content: JSON.stringify([{ text: "private RAG result" }]),
            tool_call_id: "tool-call-1",
          }),
          { langgraph_node: "tools" },
        ],
      ];
      yield [
        "messages",
        [new AIMessageChunk("visible answer"), { langgraph_node: "model" }],
      ];
      yield ["values", { messages: [] }];
    }

    let text = "";
    await consumeGraphStream(graphStream(), async (token) => {
      text += token;
    });
    expect(text).toBe("visible answer");
  });
});
