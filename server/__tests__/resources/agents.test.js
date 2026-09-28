/* eslint-env jest, node */
jest.mock("../../models/predefinedAgent", () => ({
  PredefinedAgent: {
    all: jest.fn(),
  },
}));

const { PredefinedAgent } = require("../../models/predefinedAgent");
const { agentListForPrompt } = require("../../resources/agents");

describe("Agent delegation roster", () => {
  it("includes every enabled Agent even when it is hidden from user rosters", async () => {
    PredefinedAgent.all.mockResolvedValue([
      {
        id: 1,
        name: "协调助手",
        description: "",
        tools: null,
        showInRoster: true,
      },
      {
        id: 2,
        name: "内部专家",
        description: "只处理委派任务",
        tools: ["knowledge.search"],
        showInRoster: false,
      },
    ]);

    await expect(agentListForPrompt(1)).resolves.toEqual([
      {
        id: 2,
        name: "内部专家",
        description: "只处理委派任务",
        tools: ["knowledge.search"],
      },
    ]);
    expect(PredefinedAgent.all).toHaveBeenCalledWith({ enabledOnly: true });
  });
});
