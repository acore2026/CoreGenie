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
      skill: { id: 20, name: "3gpp-position-evolution" },
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
        id: 30,
        ...value,
      })
    ),
    update: jest.fn(),
  },
}));

const prisma = require("../../utils/prisma");
const { PredefinedAgentSkill } = require("../../models/predefinedAgentSkill");
const { PredefinedAgent } = require("../../models/predefinedAgent");
const {
  seed3gppPositionEvolution,
} = require("../../agent-skills/positionEvolutionSeed");

describe("3GPP position evolution seed", () => {
  it("creates a packaged Skill and an Agent with both 3GPP Skills", async () => {
    await seed3gppPositionEvolution();

    expect(PredefinedAgentSkill.createPackage).toHaveBeenCalledTimes(1);
    const packageInput = PredefinedAgentSkill.createPackage.mock.calls[0][0];
    expect(packageInput.skillMd).toContain("name: 3gpp-position-evolution");
    expect(packageInput.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "scripts/3gpp_evolution.py",
        "references/evidence-taxonomy.md",
        "references/status-semantics.md",
      ])
    );

    expect(PredefinedAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "3GPP 技术路线与立场分析助手",
        skillIds: [20, 10],
        tools: expect.arrayContaining([
          "skill.activate",
          "skill.read_resource",
        ]),
        systemPrompt: expect.stringContaining(
          "该任务不得执行 RAG 检索、Workspace 目录遍历或会议范围研究"
        ),
        runtimeConfig: expect.objectContaining({
          requiredCompletionTools: ["knowledge.publish"],
        }),
        examplePrompts: expect.arrayContaining([
          expect.objectContaining({
            label: expect.stringContaining("Huawei 与 Ericsson"),
            prompt: expect.stringContaining("KI #18"),
          }),
        ]),
      })
    );
    expect(prisma.system_settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { label: "agent_skill_seed_3gpp_position_evolution_v7" },
      })
    );
  });
});
