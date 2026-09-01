/* eslint-env jest, node */

const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockWithPrismaRetry = jest.fn((operation) => operation());

jest.mock("../../utils/prisma", () => ({
  agent_run_commands: { upsert: mockUpsert, update: mockUpdate },
}));
jest.mock("../../utils/prismaRetry", () => ({
  withPrismaRetry: mockWithPrismaRetry,
}));

const { AgentRunCommand } = require("../../models/agentRunCommand");

describe("AgentRunCommand persistence", () => {
  beforeEach(() => jest.clearAllMocks());

  it("serializes command creation through the Prisma retry queue", async () => {
    mockUpsert.mockResolvedValue({
      id: "command-1",
      payload: '{"type":"cancel"}',
      result: null,
    });

    await expect(
      AgentRunCommand.create({
        id: "command-1",
        runId: "run-1",
        type: "run.cancel",
        payload: { type: "cancel" },
      })
    ).resolves.toMatchObject({ id: "command-1", payload: { type: "cancel" } });
    expect(mockWithPrismaRetry).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("serializes command completion through the Prisma retry queue", async () => {
    mockUpdate.mockResolvedValue({
      id: "command-1",
      payload: "{}",
      result: '{"success":true}',
    });

    await expect(
      AgentRunCommand.complete("command-1", { success: true })
    ).resolves.toMatchObject({ result: { success: true } });
    expect(mockWithPrismaRetry).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
