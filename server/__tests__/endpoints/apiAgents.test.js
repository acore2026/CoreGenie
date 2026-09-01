/* eslint-env jest, node */
jest.mock("../../agent-skills/seed", () => ({
  seedBuiltinSkills: jest.fn(),
}));
jest.mock("../../models/predefinedAgent", () => ({
  PredefinedAgent: {
    all: jest.fn(),
    defaultId: jest.fn(),
  },
}));
jest.mock("../../models/predefinedAgentSkill", () => ({
  PredefinedAgentSkill: { whereIds: jest.fn() },
}));

const { PredefinedAgent } = require("../../models/predefinedAgent");
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const { listAgents } = require("../../endpoints/api/agents");

describe("developer Agent catalog", () => {
  it("returns only safe Agent metadata and Skill names", async () => {
    PredefinedAgent.all.mockResolvedValue([
      {
        id: 2,
        name: "3GPP 提案分析助手",
        description: "description",
        systemPrompt: "secret prompt",
        tools: ["bash"],
        skillIds: [5],
        runtimeKey: "governed-agent",
        runtimeConfig: { attachmentMode: "workspace_file", secret: true },
      },
    ]);
    PredefinedAgent.defaultId.mockResolvedValue(2);
    PredefinedAgentSkill.whereIds.mockResolvedValue([
      { id: 5, name: "3gpp-review", instructions: "private" },
    ]);
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };

    await listAgents({}, response);

    expect(json).toHaveBeenCalledWith({
      agents: [
        {
          id: 2,
          name: "3GPP 提案分析助手",
          description: "description",
          default: true,
          runtime: "governed-agent",
          skillNames: ["3gpp-review"],
          attachmentMode: "workspace_file",
        },
      ],
      defaultAgentId: 2,
    });
    const payload = json.mock.calls[0][0];
    expect(payload.agents[0]).not.toHaveProperty("systemPrompt");
    expect(payload.agents[0]).not.toHaveProperty("tools");
    expect(payload.agents[0]).not.toHaveProperty("runtimeConfig");
  });
});
