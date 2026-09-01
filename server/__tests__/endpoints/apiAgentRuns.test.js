/* eslint-env jest, node */
jest.mock("../../models/agentRun", () => ({
  AgentRun: {
    get: jest.fn(),
    isTerminal: jest.fn((status) =>
      ["completed", "partial", "failed", "cancelled"].includes(status)
    ),
  },
}));
jest.mock("../../models/agentRunTask", () => ({
  AgentRunTask: { list: jest.fn() },
}));
jest.mock("../../models/agentRunEvidence", () => ({
  AgentRunEvidence: { list: jest.fn() },
}));
jest.mock("../../models/agentRunArtifact", () => ({
  AgentRunArtifact: { forRun: jest.fn() },
}));
jest.mock("../../models/agentRunEvent", () => ({
  AgentRunEvent: {
    after: jest.fn(),
    latestSequence: jest.fn(),
    traceSnapshot: jest.fn(),
  },
}));
jest.mock("../../utils/prisma", () => ({
  agent_tool_executions: { findMany: jest.fn() },
}));
jest.mock("../../agent-system/service", () => ({
  submitAgentRun: jest.fn(),
}));
jest.mock("../../agent-system/observability", () => ({
  agentTraceId: jest.fn(),
}));

const { AgentRun } = require("../../models/agentRun");
const { AgentRunTask } = require("../../models/agentRunTask");
const { AgentRunEvidence } = require("../../models/agentRunEvidence");
const { AgentRunArtifact } = require("../../models/agentRunArtifact");
const { AgentRunEvent } = require("../../models/agentRunEvent");
const prisma = require("../../utils/prisma");
const { submitAgentRun } = require("../../agent-system/service");
const { agentTraceId } = require("../../agent-system/observability");
const {
  createRun,
  sanitizeEvaluation,
  snapshotRun,
} = require("../../endpoints/agentRuns");

function responseWithLocals(locals = {}) {
  const json = jest.fn();
  const response = {
    locals,
    status: jest.fn(() => ({ json })),
  };
  return { response, json };
}

describe("developer Agent runs", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sanitizes bounded evaluation correlation fields", () => {
    expect(
      sanitizeEvaluation({
        evaluationId: ` eval-${"x".repeat(200)} `,
        suiteId: "runtime-v0",
        caseId: "direct-answer",
        attempt: 5000,
      })
    ).toEqual({
      evaluationId: `eval-${"x".repeat(123)}`,
      suiteId: "runtime-v0",
      caseId: "direct-answer",
      attempt: 1000,
    });
    expect(sanitizeEvaluation({})).toBeNull();
  });

  it("creates API-key evaluation runs with a forced source and correlation", async () => {
    const workspace = { id: 1, slug: "eval-space", chatMode: "automatic" };
    const thread = { id: 2, slug: "attempt-1" };
    const { response, json } = responseWithLocals({
      apiKey: { id: 9 },
      workspace,
      thread,
      multiUserMode: true,
    });
    submitAgentRun.mockResolvedValue({ id: "run-1", status: "queued" });

    await createRun(
      {
        body: {
          message: "Evaluate this",
          agentId: 3,
          evaluation: {
            evaluationId: "eval-1",
            suiteId: "suite-1",
            caseId: "case-1",
            attempt: 2,
          },
        },
      },
      response
    );

    expect(submitAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        thread,
        user: null,
        agentId: 3,
        source: "evaluation",
        configuration: expect.objectContaining({
          approvalMode: "always_allow",
          evaluation: {
            evaluationId: "eval-1",
            suiteId: "suite-1",
            caseId: "case-1",
            attempt: 2,
          },
        }),
      })
    );
    expect(response.status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({
      run: { id: "run-1", status: "queued" },
    });
  });

  it("returns full events, artifacts, and trace correlation in API snapshots", async () => {
    const run = { id: "run-1", status: "completed" };
    AgentRun.get.mockResolvedValue(run);
    AgentRunTask.list.mockResolvedValue([{ id: "task-1" }]);
    AgentRunEvidence.list.mockResolvedValue([]);
    prisma.agent_tool_executions.findMany.mockResolvedValue([]);
    AgentRunEvent.after.mockResolvedValue([{ id: 1, type: "run.completed" }]);
    AgentRunArtifact.forRun.mockResolvedValue([{ id: "artifact-1" }]);
    AgentRunEvent.latestSequence.mockResolvedValue(1);
    agentTraceId.mockResolvedValue("trace-1");
    const { response, json } = responseWithLocals({ apiKey: { id: 9 } });

    await snapshotRun(
      { params: { runId: "run-1" }, query: { events: "full" } },
      response
    );

    expect(AgentRunEvent.after).toHaveBeenCalledWith("run-1", 0, 50_000);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        run,
        artifacts: [{ id: "artifact-1" }],
        traceId: "trace-1",
        events: [{ id: 1, type: "run.completed" }],
      })
    );
  });
});
