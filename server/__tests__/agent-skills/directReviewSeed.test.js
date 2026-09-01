/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  system_settings: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
  },
  predefined_agent_skills: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock("../../models/predefinedAgentSkill", () => ({
  PredefinedAgentSkill: {
    createPackage: jest.fn().mockResolvedValue({
      skill: { id: 31, name: "3gpp-review-direct" },
      error: null,
    }),
    updatePackage: jest.fn(),
  },
}));

jest.mock("../../models/predefinedAgent", () => ({
  PredefinedAgent: {
    all: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((value) =>
      Promise.resolve({
        id: 32,
        ...value,
      })
    ),
    update: jest.fn(),
  },
}));

const prisma = require("../../utils/prisma");
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const { PredefinedAgent } = require("../../models/predefinedAgent");
const { seedDirect3gppReview } = require("../../agent-skills/directReviewSeed");

describe("direct 3GPP review seed", () => {
  it("creates an isolated Skill and a single-context experimental Agent", async () => {
    await seedDirect3gppReview();

    expect(PredefinedAgentSkill.createPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        skillMd: expect.stringContaining("name: 3gpp-review-direct"),
        files: [expect.objectContaining({ path: "scripts/3gpp_tdocs.py" })],
      })
    );
    expect(PredefinedAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "3GPP 提案分析助手（实验版）",
        runtimeKey: "default-react",
        runtimeConfig: {
          maxRuntimeMs: 60 * 60 * 1_000,
          disableModelCallLimit: true,
          visionModel: "qwen3.7-plus",
        },
        skillIds: [31],
        tools: expect.arrayContaining([
          "skill.activate",
          "3gpp.resolve-meeting",
          "bash",
          "vision.inspect",
        ]),
      })
    );
    const agent = PredefinedAgent.create.mock.calls[0][0];
    expect(agent.tools).not.toContain("knowledge.publish");
    expect(agent.systemPrompt).toContain("不创建任务计划");
    expect(prisma.system_settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { label: "agent_skill_seed_3gpp_review_direct_v3" },
      })
    );
  });
});
