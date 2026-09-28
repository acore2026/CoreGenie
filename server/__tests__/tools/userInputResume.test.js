/* eslint-env jest, node */
jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: {
    get: jest.fn(),
    findOperation: jest.fn(),
    begin: jest.fn(),
    finish: jest.fn(),
  },
}));

const {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  Command,
  START,
  END,
} = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { AIMessage } = require("@langchain/core/messages");
const { AgentToolExecution } = require("../../models/agentToolExecution");
const { AgentToolContext } = require("../../tools/context");
const { toLangChainTool } = require("../../tools/descriptor");
const { askUser } = require("../../tools/userInput");

describe("persisted user input interruption and resume", () => {
  let rows;
  let emit;

  beforeEach(() => {
    jest.resetAllMocks();
    rows = new Map();
    emit = jest.fn().mockResolvedValue(undefined);
    AgentToolExecution.get.mockImplementation(async (_, id) => rows.get(id));
    AgentToolExecution.findOperation.mockImplementation(
      async (_, taskId, key) =>
        [...rows.values()].filter(
          (row) => row.task_id === taskId && row.operation_key === key
        )
    );
    AgentToolExecution.begin.mockImplementation(async (args) => {
      const row = {
        call_id: args.callId,
        task_id: args.taskId,
        operation_key: args.operationKey,
        status: "running",
        result: null,
        retryable: false,
      };
      rows.set(args.callId, row);
      return row;
    });
    AgentToolExecution.finish.mockImplementation(async (_, id, result) => {
      Object.assign(rows.get(id), result, {
        status: result.status || (result.error ? "failed" : "completed"),
      });
    });
  });

  // Rebuild the graph/context on resume as the production executor does, while
  // retaining the checkpoint and persisted tool execution from before the pause.
  function buildGraph(checkpointer) {
    const context = new AgentToolContext({
      run: { id: "resume-run", configuration: {} },
      workspace: { id: 1 },
      agent: { id: 1 },
      emit,
      signal: new AbortController().signal,
    });
    return new StateGraph(MessagesAnnotation)
      .addNode("tools", new ToolNode([toLangChainTool(askUser, context)]))
      .addEdge(START, "tools")
      .addEdge("tools", END)
      .compile({ checkpointer });
  }

  it.each([
    [
      "selected answer",
      {
        skipped: false,
        answers: [{ skipped: false, answer: "6G 核心网用户面架构" }],
      },
    ],
    [
      "free-text answer",
      {
        skipped: false,
        answers: [{ skipped: false, answer: "SA2 中分层 UPF，关注最新会议" }],
      },
    ],
    ["skipped question", { skipped: true, answers: [] }],
  ])("delivers the %s instead of NO_PROGRESS", async (_, answer) => {
    const checkpointer = new MemorySaver();
    const config = { configurable: { thread_id: "resume-thread" } };
    const questions = [
      {
        question: "双层 UP 具体指哪个方向？",
        type: "single",
        options: ["6G 核心网用户面架构", "无线接入网用户面分层"],
      },
    ];
    const paused = await buildGraph(checkpointer).invoke(
      {
        messages: [
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "ask-call",
                name: "ask_user",
                args: { questions },
                type: "tool_call",
              },
            ],
          }),
        ],
      },
      config
    );

    expect(paused.__interrupt__[0].value).toMatchObject({ kind: "input" });
    expect(rows.get("ask-call")).toMatchObject({
      status: "running",
      retryable: false,
    });
    expect(AgentToolExecution.finish).not.toHaveBeenCalled();

    const resumed = await buildGraph(checkpointer).invoke(
      new Command({ resume: answer }),
      config
    );
    const reply = resumed.messages.at(-1);
    expect(reply.tool_call_id).toBe("ask-call");
    expect(JSON.parse(reply.content)).toMatchObject({
      ok: true,
      code: "OK",
      data: answer,
    });
    expect(rows.get("ask-call")).toMatchObject({
      status: "completed",
      result: { data: answer },
    });
    expect(resumed.__interrupt__).toBeUndefined();
    expect(
      emit.mock.calls.some(([type]) =>
        ["tool.failed", "tool.skipped"].includes(type)
      )
    ).toBe(false);
  });
});
