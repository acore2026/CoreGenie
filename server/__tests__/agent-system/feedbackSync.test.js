/* eslint-env jest, node */
const mockAgentFeedbackReason = { list: jest.fn() };
const mockAgentResponseFeedback = {
  markSynced: jest.fn(),
  markSyncError: jest.fn(),
};

jest.mock("../../models/agentFeedback", () => ({
  AgentFeedbackReason: mockAgentFeedbackReason,
  AgentResponseFeedback: mockAgentResponseFeedback,
}));
jest.mock("../../agent-system/observability", () => ({
  agentTraceId: jest.fn(async (runId) => `trace-${runId}`),
  langfuseConfiguration: jest.fn(() => ({ enabled: false })),
}));

const {
  RATING_SCORE_NAME,
  resetFeedbackSyncForTests,
  scoreId,
  scoreNameForReason,
  syncFeedbackRecord,
} = require("../../agent-system/feedbackSync");

function mockLangfuse(reasons) {
  const configs = [
    { id: "rating-config", name: RATING_SCORE_NAME, isArchived: false },
    ...reasons.map((reason) => ({
      id: `${reason.code}-config`,
      name: scoreNameForReason(reason.code),
      isArchived: false,
    })),
  ];
  return {
    api: {
      scoreConfigs: {
        get: jest.fn(async () => ({ data: configs })),
        create: jest.fn(),
      },
      legacy: { scoreV1: { delete: jest.fn(async () => undefined) } },
    },
    score: {
      create: jest.fn(),
      flush: jest.fn(async () => undefined),
    },
  };
}

describe("Langfuse Agent feedback sync", () => {
  const reasons = [
    { code: "incorrect", label: "内容不准确" },
    { code: "other", label: "其他" },
  ];
  const record = {
    id: "feedback-1",
    run_id: "run-1",
    chat_id: 10,
    workspace_id: 2,
    agent_id: 3,
    source: "user",
    rating: "bad",
    reasons: JSON.stringify([reasons[0]]),
    comment: "版本有误",
    deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetFeedbackSyncForTests();
    mockAgentFeedbackReason.list.mockResolvedValue(reasons);
  });

  afterEach(() => jest.restoreAllMocks());

  it("writes one categorical rating and a boolean score for every reason", async () => {
    const langfuse = mockLangfuse(reasons);
    await expect(syncFeedbackRecord(record, { langfuse })).resolves.toBe(true);
    expect(langfuse.score.create).toHaveBeenCalledTimes(3);
    expect(langfuse.score.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: scoreId(record.id, RATING_SCORE_NAME),
        traceId: "trace-run-1",
        name: RATING_SCORE_NAME,
        value: "bad",
        dataType: "CATEGORICAL",
        comment: "原因：内容不准确\n版本有误",
      })
    );
    expect(langfuse.score.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "user-reason-incorrect",
        value: 1,
        dataType: "BOOLEAN",
      })
    );
    expect(langfuse.score.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "user-reason-other", value: 0 })
    );
    expect(mockAgentResponseFeedback.markSynced).toHaveBeenCalledWith(
      record.id
    );
  });

  it("deletes deterministic remote scores when feedback is withdrawn", async () => {
    const langfuse = mockLangfuse(reasons);
    await expect(
      syncFeedbackRecord({ ...record, deletedAt: new Date() }, { langfuse })
    ).resolves.toBe(true);
    expect(langfuse.api.legacy.scoreV1.delete).toHaveBeenCalledTimes(3);
    expect(langfuse.score.create).not.toHaveBeenCalled();
  });

  it("still syncs scores when the API key cannot manage score configs", async () => {
    const langfuse = mockLangfuse(reasons);
    langfuse.api.scoreConfigs.get.mockRejectedValue(new Error("forbidden"));
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(syncFeedbackRecord(record, { langfuse })).resolves.toBe(true);
    expect(langfuse.score.create).toHaveBeenCalledTimes(3);
    expect(langfuse.score.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: RATING_SCORE_NAME,
        configId: undefined,
      })
    );
    expect(mockAgentResponseFeedback.markSynced).toHaveBeenCalledWith(
      record.id
    );
  });

  it("keeps local feedback pending for retry when Langfuse rejects a flush", async () => {
    const langfuse = mockLangfuse(reasons);
    jest.spyOn(console, "error").mockImplementation(() => {});
    langfuse.score.flush.mockRejectedValue(new Error("network unavailable"));
    await expect(syncFeedbackRecord(record, { langfuse })).resolves.toBe(false);
    expect(mockAgentResponseFeedback.markSyncError).toHaveBeenCalledWith(
      record.id,
      "network unavailable"
    );
  });
});
