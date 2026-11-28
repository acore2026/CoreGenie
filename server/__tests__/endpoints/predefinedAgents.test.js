/* eslint-env jest, node */
jest.mock("../../utils/MCP", () =>
  jest.fn().mockImplementation(() => ({
    activeMCPServers: jest.fn().mockResolvedValue([]),
  }))
);

const {
  activeToolOptions,
  cleanExamplePrompts,
  predefinedAgentEndpoints,
  validateAgentPayload,
} = require("../../endpoints/predefinedAgents");
const { PredefinedAgent } = require("../../models/predefinedAgent");

afterEach(() => jest.restoreAllMocks());

describe("roster display order permissions", () => {
  function route() {
    const routes = new Map();
    predefinedAgentEndpoints({
      get: jest.fn(), put: jest.fn(), delete: jest.fn(),
      post: (path, middleware, handler) => routes.set(path, { middleware, handler }),
    });
    return routes.get("/admin/display-order/:kind");
  }

  it("requires the administrator role in multi-user mode", async () => {
    const next = jest.fn();
    const response = { locals: { multiUserMode: true, user: { role: "default" } }, sendStatus: jest.fn().mockReturnValue({ end: jest.fn() }) };
    await route().middleware[1]({}, response, next);
    expect(response.sendStatus).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    response.locals.user.role = "admin";
    await route().middleware[1]({}, response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("saves only supported list kinds and reports validation errors", async () => {
    const { DisplayOrder } = require("../../models/displayOrder");
    const save = jest.spyOn(DisplayOrder, "save").mockResolvedValue();
    const response = { json: jest.fn(), sendStatus: jest.fn(), status: jest.fn() };
    response.status.mockReturnValue(response);
    const { handler } = route();
    await handler({ params: { kind: "agents" }, body: { ids: [2, 1] } }, response);
    expect(save).toHaveBeenCalledWith("agents", [2, 1]);
    await handler({ params: { kind: "unknown" }, body: {} }, response);
    expect(response.sendStatus).toHaveBeenCalledWith(404);
    save.mockRejectedValue(new Error("invalid order"));
    await handler({ params: { kind: "quick-tasks" }, body: { ids: [9] } }, response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: "invalid order" });
  });
});

describe("predefined Agent example prompts", () => {
  it("keeps a short label and a detailed prompt as separate values", () => {
    expect(
      cleanExamplePrompts([
        {
          label: "比较两家公司在指定 KI 上的路线",
          prompt: "聚焦 KI #18，按会议比较 Huawei 与 Ericsson 的提案。",
        },
      ])
    ).toEqual([
      {
        label: "比较两家公司在指定 KI 上的路线",
        prompt: "聚焦 KI #18，按会议比较 Huawei 与 Ericsson 的提案。",
      },
    ]);
  });

  it("continues to accept existing string prompts", () => {
    expect(cleanExamplePrompts(["分析指定提案"])).toEqual(["分析指定提案"]);
  });
});

describe("predefined Agent availability", () => {
  it("keeps runtime availability separate from roster visibility", () => {
    expect(
      validateAgentPayload({
        name: "内部研究助手",
        systemPrompt: "完成委派的研究任务。",
        enabled: true,
        showInRoster: false,
      })
    ).toEqual({
      data: expect.objectContaining({
        enabled: true,
        showInRoster: false,
      }),
    });
  });

  it("offers Agent delegation as an explicit tool permission", async () => {
    await expect(activeToolOptions()).resolves.toContainEqual({
      id: "agent.call",
      name: "调用其他 Agent",
    });
  });

  it("allows the built-in global default Agent to be disabled", async () => {
    const routes = new Map();
    const app = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
      put: jest.fn((path, _middleware, handler) => routes.set(path, handler)),
    };
    predefinedAgentEndpoints(app);
    jest.spyOn(PredefinedAgent, "get").mockResolvedValue({
      id: 2,
      name: "通用助手",
      isBuiltinDefault: true,
      enabled: true,
    });
    jest.spyOn(PredefinedAgent, "update").mockResolvedValue({
      id: 2,
      name: "通用助手",
      isBuiltinDefault: true,
      enabled: false,
    });
    const json = jest.fn();
    const response = {
      status: jest.fn(() => ({ json })),
    };

    await routes.get("/admin/predefined-agents/:id")(
      {
        params: { id: "2" },
        body: {
          name: "通用助手",
          systemPrompt: "You are a helpful assistant.",
          enabled: false,
        },
      },
      response
    );

    expect(PredefinedAgent.update).toHaveBeenCalledWith(
      "2",
      expect.objectContaining({ enabled: false })
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        agent: expect.objectContaining({ enabled: false }),
      })
    );
  });

  it("falls back to the enabled built-in default agent when no valid default setting exists", async () => {
    const prisma = require("../../utils/prisma");
    const { SystemSettings } = require("../../models/systemSettings");
    jest.spyOn(SystemSettings, "getValueOrFallback").mockResolvedValue("99");
    jest.spyOn(PredefinedAgent, "get").mockResolvedValue(null);
    jest
      .spyOn(prisma.predefined_agents, "findFirst")
      .mockResolvedValue({ id: 7 });

    await expect(PredefinedAgent.defaultId()).resolves.toBe(7);
    expect(prisma.predefined_agents.findFirst).toHaveBeenCalledWith({
      where: { isBuiltinDefault: true, enabled: true, showInRoster: true },
      select: { id: true },
    });
  });
});

describe("predefined Agent runtime selection", () => {
  it("keeps a selected registered runtime and normalizes its configuration", () => {
    expect(
      validateAgentPayload({
        name: "研究助手",
        systemPrompt: "根据资料完成研究。",
        runtimeKey: "evidence-research",
        runtimeConfig: {
          plannerModel: "planner-v1",
          unknown: "discarded",
        },
      })
    ).toEqual({
      data: expect.objectContaining({
        runtimeKey: "evidence-research",
        runtimeConfig: expect.objectContaining({
          attachmentMode: "parsed",
          plannerModel: "planner-v1",
          requiredCompletionTools: [],
        }),
      }),
    });
  });

  it("rejects an unregistered runtime", () => {
    expect(
      validateAgentPayload({
        name: "测试助手",
        systemPrompt: "完成测试。",
        runtimeKey: "unknown-runtime",
      })
    ).toEqual({ error: 'Unknown Agent runtime "unknown-runtime".' });
  });
});
