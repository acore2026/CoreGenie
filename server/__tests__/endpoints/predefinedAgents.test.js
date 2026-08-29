/* eslint-env jest, node */
const {
  cleanExamplePrompts,
  predefinedAgentEndpoints,
} = require("../../endpoints/predefinedAgents");
const { PredefinedAgent } = require("../../models/predefinedAgent");

afterEach(() => jest.restoreAllMocks());

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
});
