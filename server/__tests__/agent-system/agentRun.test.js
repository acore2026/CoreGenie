/* eslint-env jest, node */
const mockFindFirst = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock("../../utils/prisma", () => ({
  agent_runs: { findFirst: mockFindFirst, deleteMany: mockDeleteMany },
}));

const { AgentRun } = require("../../models/agentRun");

describe("AgentRun.activeForConversation", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockDeleteMany.mockReset();
  });

  it("finds a threaded run without filtering by the current viewer", async () => {
    mockFindFirst.mockResolvedValue(null);

    await AgentRun.activeForConversation({
      workspaceId: 7,
      threadId: 104,
      userId: 1,
    });

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace_id: 7,
          thread_id: 104,
        }),
      })
    );
    expect(mockFindFirst.mock.calls[0][0].where).not.toHaveProperty("user_id");
  });

  it("keeps bare-workspace runs isolated by user", async () => {
    mockFindFirst.mockResolvedValue(null);

    await AgentRun.activeForConversation({
      workspaceId: 7,
      threadId: null,
      userId: 1,
    });

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace_id: 7,
          thread_id: null,
          user_id: 1,
        }),
      })
    );
  });

  it("deletes all Agent runs for a purged workspace", async () => {
    mockDeleteMany.mockResolvedValue({ count: 4 });

    await expect(AgentRun.deleteForWorkspace(7)).resolves.toBe(4);

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { workspace_id: 7 },
    });
  });

  it("does not issue a broad delete for an invalid workspace id", async () => {
    await expect(AgentRun.deleteForWorkspace("invalid")).resolves.toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
