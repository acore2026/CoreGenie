/* eslint-env jest, node */
jest.mock("../../agent-system/feedbackSync", () => ({
  queueAgentFeedbackSync: jest.fn(),
}));

const {
  AgentFeedbackReason,
  AgentResponseFeedback,
} = require("../../models/agentFeedback");
const { AgentRun } = require("../../models/agentRun");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { agentFeedbackEndpoints } = require("../../endpoints/agentFeedback");

function feedbackHandler() {
  const routes = new Map();
  const register =
    (method) =>
    (path, ...handlers) =>
      routes.set(`${method} ${path}`, handlers.at(-1));
  const app = {
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    put: register("PUT"),
  };
  agentFeedbackEndpoints(app);
  return routes.get("PUT /workspace/:slug/agent-feedback/:chatId");
}

function response() {
  const result = {
    locals: { workspace: { id: 2 }, multiUserMode: false },
    status: jest.fn(),
    json: jest.fn(),
  };
  result.status.mockReturnValue(result);
  return result;
}

describe("Agent feedback endpoint", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(WorkspaceChats, "get").mockResolvedValue({
      id: 10,
      workspaceId: 2,
      user_id: null,
      thread_id: null,
      response: JSON.stringify({
        text: "分析结果",
        agentRunId: "run-10",
        agentId: 3,
      }),
    });
    jest.spyOn(AgentRun, "get").mockResolvedValue({
      id: "run-10",
      workspace_id: 2,
      agent_id: 3,
    });
    jest.spyOn(WorkspaceChats, "_update").mockResolvedValue(true);
    jest.spyOn(AgentResponseFeedback, "getForChat").mockResolvedValue(null);
  });

  it("requires a reason for neutral and bad ratings", async () => {
    const res = response();
    jest.spyOn(AgentFeedbackReason, "getByCodes").mockResolvedValue([]);
    const upsert = jest
      .spyOn(AgentResponseFeedback, "upsert")
      .mockResolvedValue(null);

    await feedbackHandler()(
      {
        params: { chatId: "10", slug: "research" },
        body: { rating: "neutral", reasonCodes: [], comment: "" },
        header: jest.fn(),
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "请选择至少一个原因。" })
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does not validate stale reason selections when saving a good rating", async () => {
    const res = response();
    const getReasons = jest
      .spyOn(AgentFeedbackReason, "getByCodes")
      .mockResolvedValue([]);
    jest.spyOn(AgentResponseFeedback, "upsert").mockResolvedValue({
      record: { id: "feedback-10" },
      feedback: {
        rating: "good",
        reasonCodes: [],
        reasons: [],
        comment: "",
      },
    });

    await feedbackHandler()(
      {
        params: { chatId: "10", slug: "research" },
        body: { rating: "good", reasonCodes: ["other"], comment: "" },
        header: jest.fn(),
      },
      res
    );

    expect(getReasons).toHaveBeenCalledWith([], { includeDisabled: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(AgentResponseFeedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        chatUpdate: expect.objectContaining({ feedbackScore: true }),
      })
    );
  });
});
