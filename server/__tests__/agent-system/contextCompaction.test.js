const { createAgent } = require("langchain");
const { MemorySaver } = require("@langchain/langgraph");
const {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const { FakeListChatModel } = require("@langchain/core/utils/testing");
const {
  compactHistory,
  contextCompactionMiddleware,
  createEstimator,
  historyUnits,
  INPUT_LIMIT,
  TRIGGER_TOKENS,
  TARGET_TOKENS,
  NOTE_KEY,
  INTERNAL_TAG,
} = require("../../agent-system/contextCompaction");
const { consumeGraphStream } = require("../../agent-system/runtimes/stream");

const estimate = (messages) =>
  messages.reduce(
    (sum, message) =>
      sum +
      String(message.content).length +
      JSON.stringify(message.tool_calls || []).length,
    0
  );

function batch(
  index,
  { size = 1000, name = "filesystem_write", calls = 1 } = {}
) {
  const toolCalls = Array.from({ length: calls }, (_, item) => ({
    id: "call-" + index + "-" + item,
    name,
    args: {
      path: "/workspace/report-" + index + ".md",
      content: "w".repeat(size),
    },
    type: "tool_call",
  }));
  return [
    new AIMessage({ content: "", tool_calls: toolCalls }),
    ...toolCalls.map(
      (call) =>
        new ToolMessage({
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            code: "OK",
            summary: "Wrote " + call.args.path,
            data: "evidence".repeat(Math.ceil(size / 8)),
          }),
        })
    ),
  ];
}
function history() {
  return [
    new HumanMessage("分析 KI5；仅使用官方来源，不要自动入库。"),
    ...Array.from({ length: 6 }, (_, index) => batch(index)).flat(),
  ];
}
const baseOptions = (messages = history()) => ({
  messages,
  estimate,
  trigger: 10000,
  target: 2500,
  summarize: jest
    .fn()
    .mockResolvedValue(
      "已完成早期分析，报告已保存；仍须核验会议状态和图片，继续处理剩余文稿。"
    ),
});

describe("opt-in ReAct context compaction", () => {
  it("uses the agreed fixed input budget and percentages", () => {
    expect(INPUT_LIMIT).toBe(169984);
    expect(TRIGGER_TOKENS).toBe(161484);
    expect(TARGET_TOKENS).toBe(84992);
  });

  it("does nothing below the trigger", async () => {
    const options = baseOptions([new HumanMessage("hello")]);
    expect(await compactHistory(options)).toBeNull();
    expect(options.summarize).not.toHaveBeenCalled();
  });

  it("keeps user corrections, instructions, and two recent complete tool batches", async () => {
    const messages = history();
    const instruction = new SystemMessage("必须区分提案与批准结果");
    const correction = new HumanMessage("先检查图片，没验证的标出来");
    messages.splice(3, 0, correction);
    messages.unshift(instruction);
    const original = JSON.stringify(messages);
    const options = baseOptions(messages);
    const result = await compactHistory(options);
    expect(options.summarize).toHaveBeenCalledTimes(1);
    expect(result).toContain(instruction);
    expect(result).toContain(correction);
    expect(result).toContain(messages[1]);
    expect(result.slice(-4)).toEqual(messages.slice(-4));
    expect(estimate(result)).toBeLessThan(options.trigger);
    // A missed 50% target does not cause repeated summarization or deletion.
    expect(estimate(result)).toBeGreaterThan(options.target);
    expect(
      result.filter((m) => m.additional_kwargs[NOTE_KEY] === "pruned")
    ).toHaveLength(0);
    expect(JSON.stringify(messages)).toBe(original);
  });

  it("merges the previous checkpoint rather than keeping growing summary copies", async () => {
    const messages = history();
    messages.splice(
      1,
      0,
      new HumanMessage({
        content: "obsolete checkpoint",
        additional_kwargs: { [NOTE_KEY]: "summary" },
      })
    );
    const options = baseOptions(messages);
    const result = await compactHistory(options);
    expect(
      options.summarize.mock.calls[0][0].messages.some(
        (m) => m.content === "obsolete checkpoint"
      )
    ).toBe(true);
    expect(
      result.filter((m) => m.additional_kwargs[NOTE_KEY] === "summary")
    ).toHaveLength(1);
  });

  it.each(["activate_skill", "read_skill_resource"])(
    "preserves activated instructions from %s",
    async (name) => {
      const skill = batch("skill", { name, size: 100 });
      const messages = [...skill, ...history()];
      const result = await compactHistory(baseOptions(messages));
      for (const message of skill) expect(result).toContain(message);
    }
  );

  it("keeps all results of a parallel tool batch together", () => {
    const messages = [...batch(0, { calls: 3 }), ...batch(1), ...batch(2)];
    const units = historyUnits(messages);
    expect(units[0]).toMatchObject({ toolGroup: true, protected: false });
    expect(units[0].messages).toHaveLength(4);
  });

  it("never drops incomplete, duplicated, or orphan tool results", () => {
    const incomplete = batch("open", { calls: 2 }).slice(0, 2);
    const duplicated = batch("duplicate", { calls: 2 });
    duplicated[2] = duplicated[1];
    const orphan = new ToolMessage({
      content: "orphan",
      tool_call_id: "absent",
    });
    const units = historyUnits([
      ...incomplete,
      ...duplicated,
      orphan,
      ...history(),
    ]);
    for (const unit of units.slice(0, 2)) expect(unit.protected).toBe(true);
  });

  it.each(["throws", "empty", "larger"])(
    "prunes old complete calls when summary %s",
    async (failure) => {
      const options = baseOptions();
      if (failure === "throws")
        options.summarize.mockRejectedValue(new Error("provider unavailable"));
      if (failure === "empty") options.summarize.mockResolvedValue("");
      if (failure === "larger")
        options.summarize.mockResolvedValue("x".repeat(30000));
      const original = JSON.stringify(options.messages);
      const result = await compactHistory(options);
      expect(estimate(result)).toBeLessThan(options.trigger);
      expect(result.slice(-4)).toEqual(options.messages.slice(-4));
      const notes = result.filter(
        (m) => m.additional_kwargs[NOTE_KEY] === "pruned"
      );
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].content).toContain("/workspace/report-0.md");
      expect(notes[0].content).toContain("call-0-0");
      expect(notes[0].content).not.toContain("w".repeat(300));
      expect(JSON.stringify(options.messages)).toBe(original);
    }
  );

  it("does not discard protected user content to force the budget", async () => {
    const messages = [
      new HumanMessage("x".repeat(12000)),
      ...batch(0),
      ...batch(1),
    ];
    const options = baseOptions(messages);
    await expect(compactHistory(options)).rejects.toMatchObject({
      code: "CONTEXT_BUDGET_EXCEEDED",
    });
    expect(options.summarize).not.toHaveBeenCalled();
  });

  it("honors cancellation during summarization without pruning", async () => {
    const controller = new AbortController();
    const options = baseOptions();
    const original = JSON.stringify(options.messages);
    options.signal = controller.signal;
    options.summarize.mockImplementation(async () => {
      controller.abort(new Error("cancelled by user"));
      return "summary";
    });
    await expect(compactHistory(options)).rejects.toThrow("cancelled by user");
    expect(JSON.stringify(options.messages)).toBe(original);
  });

  it("counts system instructions, tool schemas and tool arguments", () => {
    const empty = createEstimator("", []);
    const withSystem = createEstimator("必须验证所有来源。".repeat(100), []);
    const withTools = createEstimator("", [
      {
        type: "function",
        function: {
          name: "write_file",
          description: "x".repeat(2000),
          parameters: {
            type: "object",
            properties: { content: { type: "string" } },
          },
        },
      },
    ]);
    expect(withSystem([])).toBeGreaterThan(empty([]));
    expect(withTools([])).toBeGreaterThan(empty([]));
    expect(empty(batch(1, { size: 4000 }))).toBeGreaterThan(
      empty(batch(1, { size: 10 }))
    );
    expect(empty([new HumanMessage("中文🙂<|endoftext|>")])).toBeGreaterThan(
      empty([])
    );
  });

  it("rejects a truncated summary and uses old-call pruning", async () => {
    const invoke = jest.fn().mockResolvedValue(
      new AIMessage({
        content: "half a checkpoint",
        response_metadata: { finish_reason: "length" },
      })
    );
    const middleware = contextCompactionMiddleware({
      run: { prompt: "KI5" },
      systemPrompt: "official sources",
      tools: [],
      createSummaryModel: () => ({ invoke }),
      estimate,
      trigger: 10000,
      target: 2500,
    });
    const update = await middleware.beforeModel({ messages: history() }, {});
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].tags).toContain(INTERNAL_TAG);
    expect(
      update.messages.some((m) => m.additional_kwargs?.[NOTE_KEY] === "summary")
    ).toBe(false);
    expect(
      update.messages.some((m) => m.additional_kwargs?.[NOTE_KEY] === "pruned")
    ).toBe(true);
  });

  it("checkpoints the replacement and reuses it with a newly constructed graph", async () => {
    const checkpointer = new MemorySaver();
    const summarize = jest
      .fn()
      .mockResolvedValue(
        new AIMessage("已完成早期操作；保留路径与来源，继续核验。")
      );
    function graph() {
      return createAgent({
        model: new FakeListChatModel({ responses: ["done"] }),
        tools: [],
        checkpointer,
        middleware: [
          contextCompactionMiddleware({
            run: { prompt: "KI5" },
            systemPrompt: "",
            tools: [],
            createSummaryModel: () => ({ invoke: summarize }),
            estimate,
            trigger: 10000,
            target: 2500,
          }),
        ],
      });
    }
    const config = { configurable: { thread_id: "context-checkpoint" } };
    const first = graph();
    await first.invoke({ messages: history() }, config);
    const checkpoint = await first.getState(config);
    expect(
      checkpoint.values.messages.some(
        (m) => m.additional_kwargs?.[NOTE_KEY] === "summary"
      )
    ).toBe(true);
    expect(
      checkpoint.values.messages.some((m) => m.tool_call_id === "call-0-0")
    ).toBe(false);
    expect(
      checkpoint.values.messages.some((m) => m.tool_call_id === "call-5-0")
    ).toBe(true);
    const next = await graph().invoke(
      { messages: [new HumanMessage("继续")] },
      config
    );
    expect(next.messages.at(-1).content).toBe("done");
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("never streams internal compaction text into the visible answer", async () => {
    async function* stream() {
      yield [
        "messages",
        [
          new AIMessageChunk("private summary"),
          { purpose: "context-compaction" },
        ],
      ];
      yield [
        "messages",
        [new AIMessageChunk("private summary 2"), { tags: [INTERNAL_TAG] }],
      ];
      yield [
        "messages",
        [new AIMessageChunk("visible"), { langgraph_node: "model" }],
      ];
    }
    const visible = [];
    await consumeGraphStream(stream(), (text) => visible.push(text));
    expect(visible).toEqual(["visible"]);
  });
});

describe("real checkpoint and streaming integration", () => {
  it("persists pruning through PostgreSQL and never replays historical tools", async () => {
    const { Pool } = require("pg");
    const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
    const { createPgliteTestDb } = require("../helpers/pgliteTestDb");
    const testDb = await createPgliteTestDb({ applySchema: false });
    const pgUrl = testDb.url.replace(/\?.*$/, "");
    const openSaver = () =>
      new PostgresSaver(new Pool({ connectionString: pgUrl, max: 1 }));
    let saver = openSaver();
    await saver.setup();
    const config = { configurable: { thread_id: "durable-context" } };
    const summaryCalls = [];
    const factory = () => {
      const summaryModel = new FakeListChatModel({
        responses: ["内部摘要，不能显示给用户。"],
      });
      const original = summaryModel.invoke.bind(summaryModel);
      summaryModel.invoke = (...args) => {
        summaryCalls.push(args);
        return original(...args);
      };
      return summaryModel;
    };
    const makeGraph = () =>
      createAgent({
        model: new FakeListChatModel({ responses: ["实际答复"] }),
        tools: [],
        checkpointer: saver,
        middleware: [
          contextCompactionMiddleware({
            run: { prompt: "KI5" },
            systemPrompt: "",
            tools: [],
            createSummaryModel: factory,
            estimate,
            trigger: 10000,
            target: 2500,
          }),
        ],
      });
    try {
      const graph = makeGraph();
      const stream = await graph.stream(
        { messages: history() },
        { ...config, streamMode: ["messages", "values"] }
      );
      let visible = "";
      await consumeGraphStream(stream, (token) => {
        visible += token;
      });
      expect(visible).toBe("实际答复");
      await saver.end();
      await new Promise((resolve) => setTimeout(resolve, 100));
      saver = openSaver();
      const restored = makeGraph();
      const state = await restored.getState(config);
      expect(
        state.values.messages.some(
          (m) => m.additional_kwargs?.[NOTE_KEY] === "summary"
        )
      ).toBe(true);
      expect(
        state.values.messages.some((m) => m.tool_call_id === "call-0-0")
      ).toBe(false);
      const resumed = await restored.invoke(
        { messages: [new HumanMessage("继续")] },
        config
      );
      expect(resumed.messages.at(-1).content).toBe("实际答复");
      // Historical tools are deliberately not installed. Replaying a write
      // would fail this graph; only the next model node may execute.
      expect(summaryCalls).toHaveLength(1);
    } finally {
      await saver.end().catch(() => {});
      await testDb.close();
    }
  }, 30000);

  it("skips an oversized summary request and falls back without calling the model", async () => {
    const invoke = jest.fn();
    const large = Array.from({ length: 90000 }, (_, i) => "evidence-" + i).join(
      " "
    );
    const messages = [
      new HumanMessage("original task"),
      ...batch(0),
      ...batch(1),
      ...batch(2),
    ];
    messages[2] = new ToolMessage({ content: large, tool_call_id: "call-0-0" });
    const middleware = contextCompactionMiddleware({
      run: { prompt: "KI5" },
      systemPrompt: "",
      tools: [],
      createSummaryModel: () => ({ invoke }),
      estimate,
      trigger: 10000,
      target: 2500,
    });
    const update = await middleware.beforeModel({ messages }, {});
    expect(invoke).not.toHaveBeenCalled();
    expect(
      update.messages.some((m) => m.additional_kwargs?.[NOTE_KEY] === "pruned")
    ).toBe(true);
  });
});

it("handles legacy null tool results during fallback", async () => {
  const options = baseOptions();
  options.messages[2] = new ToolMessage({
    content: "null",
    tool_call_id: "call-0-0",
  });
  options.summarize.mockRejectedValue(new Error("offline"));
  const result = await compactHistory(options);
  expect(estimate(result)).toBeLessThan(options.trigger);
});
