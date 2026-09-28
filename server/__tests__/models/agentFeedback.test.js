/* eslint-env jest, node */
const mockPrisma = {
  $transaction: jest.fn(async (operation) => operation(mockPrisma)),
  agent_feedback_reasons: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  agent_response_feedback: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  workspace_chats: { update: jest.fn() },
};

jest.mock("../../utils/prisma", () => mockPrisma);

const {
  AgentFeedbackReason,
  AgentResponseFeedback,
} = require("../../models/agentFeedback");

describe("Agent feedback models", () => {
  beforeEach(() => jest.clearAllMocks());

  it("validates immutable reason codes before writing", async () => {
    await expect(
      AgentFeedbackReason.create({ code: "Contains spaces", label: "测试" })
    ).resolves.toMatchObject({ reason: null });
    await expect(
      AgentFeedbackReason.create({ code: "x".repeat(24), label: "测试" })
    ).resolves.toMatchObject({ reason: null });
    expect(mockPrisma.agent_feedback_reasons.create).not.toHaveBeenCalled();
  });

  it("never allows the fallback other reason to be disabled", async () => {
    mockPrisma.agent_feedback_reasons.findUnique.mockResolvedValue({
      id: 7,
      code: "other",
      label: "其他",
      enabled: true,
      sortOrder: 70,
    });
    await expect(
      AgentFeedbackReason.update(7, { enabled: false })
    ).resolves.toEqual({ reason: null, error: "“其他”不能停用。" });
    expect(mockPrisma.agent_feedback_reasons.update).not.toHaveBeenCalled();
  });

  it("stores a stable reason label snapshot with each rating", async () => {
    mockPrisma.agent_response_feedback.upsert.mockImplementation(
      async ({ create }) => ({ ...create, deletedAt: null })
    );
    const result = await AgentResponseFeedback.upsert({
      chat: { id: 12, workspaceId: 4, user_id: 8 },
      runId: "run-12",
      agentId: 3,
      rating: "bad",
      reasons: [{ code: "incorrect", label: "内容不准确" }],
      comment: "引用了错误版本",
      chatUpdate: {
        response: JSON.stringify({ responseEvaluation: { rating: "bad" } }),
        feedbackScore: false,
      },
    });
    expect(mockPrisma.agent_response_feedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reasons: JSON.stringify([
            { code: "incorrect", label: "内容不准确" },
          ]),
          syncStatus: "pending",
        }),
      })
    );
    expect(result.feedback).toMatchObject({
      rating: "bad",
      reasonCodes: ["incorrect"],
      comment: "引用了错误版本",
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.workspace_chats.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({ feedbackScore: false }),
    });
  });
});
