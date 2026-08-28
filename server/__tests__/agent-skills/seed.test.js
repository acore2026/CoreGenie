/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  system_settings: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
  },
  predefined_agent_skills: {
    findFirst: jest
      .fn()
      .mockImplementation(({ where }) =>
        Promise.resolve(
          where.name === "3gpp-tdocs" ? { id: 10, name: "3gpp-tdocs" } : null
        )
      ),
  },
}));

jest.mock("../../models/predefinedAgentSkill", () => ({
  PredefinedAgentSkill: {
    get: jest.fn().mockResolvedValue({ id: 10, name: "3gpp-tdocs" }),
    createPackage: jest.fn().mockResolvedValue({
      skill: { id: 11, name: "3gpp-lookup" },
      error: null,
    }),
    updatePackage: jest.fn().mockResolvedValue({
      skill: { id: 10, name: "3gpp-review" },
      error: null,
    }),
  },
}));

jest.mock("../../models/predefinedAgent", () => ({
  PredefinedAgent: {
    all: jest.fn().mockResolvedValue([
      {
        id: 2,
        name: "通用助手",
        isBuiltinDefault: true,
        skillIds: [10],
      },
    ]),
    create: jest.fn().mockImplementation((value) =>
      Promise.resolve({
        id: 30,
        ...value,
      })
    ),
    update: jest.fn(),
    defaultId: jest.fn().mockResolvedValue(null),
    get: jest.fn(),
  },
}));

jest.mock("../../agent-skills/positionEvolutionSeed", () => ({
  seed3gppPositionEvolution: jest.fn(),
}));

const prisma = require("../../utils/prisma");
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const { PredefinedAgent } = require("../../models/predefinedAgent");
const { seed3gppReview } = require("../../agent-skills/seed");

describe("3GPP review seed", () => {
  it("migrates the legacy skill name in place and preserves its bindings", async () => {
    await seed3gppReview();

    expect(PredefinedAgentSkill.createPackage).toHaveBeenCalledTimes(1);
    expect(PredefinedAgentSkill.updatePackage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        skillMd: expect.stringContaining("name: 3gpp-review"),
      })
    );
    expect(PredefinedAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "3GPP 提案分析助手（Skill）",
        skillIds: [10, 11],
        runtimeConfig: expect.objectContaining({
          publicationRequiresCoverage: true,
        }),
      })
    );
    expect(PredefinedAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "3GPP 提案转 Markdown 助手",
        skillIds: [10],
        runtimeConfig: expect.objectContaining({
          attachmentMode: "workspace_file",
        }),
        tools: expect.not.arrayContaining(["knowledge.publish"]),
      })
    );
    expect(PredefinedAgentSkill.createPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        skillMd: expect.stringContaining("name: 3gpp-lookup"),
      })
    );
    expect(PredefinedAgent.update).toHaveBeenCalledWith(2, {
      skillIds: [11],
    });
    expect(prisma.system_settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { label: "agent_skill_seed_3gpp_review_v10" },
      })
    );
  });
});
