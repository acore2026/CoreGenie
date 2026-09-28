/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  agent_runs: {
    findMany: jest.fn(),
  },
  agent_tool_executions: {
    updateMany: jest.fn(),
  },
}));

const prisma = require("../../utils/prisma");
const {
  ACTIVE_STATUSES,
  AgentToolExecution,
} = require("../../models/agentToolExecution");

describe("AgentToolExecution lifecycle reconciliation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("closes active calls for a resumed or terminal run", async () => {
    prisma.agent_tool_executions.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      AgentToolExecution.reconcileActive("run-1", {
        error: "Worker restarted.",
        outcomeCode: "WORKER_RESTARTED",
      })
    ).resolves.toEqual({ count: 2 });

    expect(prisma.agent_tool_executions.updateMany).toHaveBeenCalledWith({
      where: {
        run_id: "run-1",
        status: { in: ACTIVE_STATUSES },
      },
      data: expect.objectContaining({
        status: "cancelled",
        error: "Worker restarted.",
        outcome_code: "WORKER_RESTARTED",
        retryable: false,
        completedAt: expect.any(Date),
      }),
    });
  });

  it("repairs active tool rows belonging to historical terminal runs", async () => {
    prisma.agent_runs.findMany.mockResolvedValue([
      { id: "run-1" },
      { id: "run-2" },
    ]);
    prisma.agent_tool_executions.updateMany.mockResolvedValue({ count: 3 });

    await expect(AgentToolExecution.reconcileTerminalRuns()).resolves.toEqual({
      count: 3,
    });

    expect(prisma.agent_tool_executions.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          run_id: { in: ["run-1", "run-2"] },
          status: { in: ACTIVE_STATUSES },
        },
      })
    );
  });

  it("does not issue an update when no terminal runs exist", async () => {
    prisma.agent_runs.findMany.mockResolvedValue([]);

    await expect(AgentToolExecution.reconcileTerminalRuns()).resolves.toEqual({
      count: 0,
    });
    expect(prisma.agent_tool_executions.updateMany).not.toHaveBeenCalled();
  });
});
