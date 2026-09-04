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

  it("assigns one turn id to chunks from the same model step", async () => {
    async function* graphStream() {
      yield [
        "messages",
        [new AIMessageChunk("first "), { langgraph_node: "model", langgraph_step: 1 }],
      ];
      yield [
        "messages",
        [new AIMessageChunk("turn"), { langgraph_node: "model", langgraph_step: 1 }],
      ];
      yield [
        "messages",
        [new AIMessageChunk("second"), { langgraph_node: "model", langgraph_step: 3 }],
      ];
    }

    const turns = [];
    const deltas = [];
    await consumeGraphStream(
      graphStream(),
      async (token, metadata) => deltas.push([token, metadata.turnId]),
      { onTurnStart: async ({ turnId }) => turns.push(turnId) }
    );

    expect(turns).toEqual(["turn-1", "turn-2"]);
    expect(deltas).toEqual([
      ["first ", "turn-1"],
      ["turn", "turn-1"],
      ["second", "turn-2"],
    ]);
  });

  it("announces a tool-only assistant turn", async () => {
    async function* graphStream() {
      yield [
        "messages",
        [
          new AIMessageChunk({
            content: "",
            tool_call_chunks: [
              { id: "call-1", name: "search", args: "{}", index: 0 },
            ],
          }),
          { langgraph_node: "model", langgraph_step: 1 },
        ],
      ];
    }

    const turns = [];
    await consumeGraphStream(graphStream(), async () => {}, {
      onTurnStart: async ({ turnId }) => turns.push(turnId),
    });
    expect(turns).toEqual(["turn-1"]);
  });
});
