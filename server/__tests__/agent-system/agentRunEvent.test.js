/* eslint-env jest, node */
const mockFindMany = jest.fn();

jest.mock("../../utils/prisma", () => ({
  agent_run_events: { findMany: mockFindMany },
}));
jest.mock("../../agent-system/eventBus", () => ({
  agentRunEventBus: { publish: jest.fn() },
}));
jest.mock("../../utils/prismaRetry", () => ({
  withPrismaRetry: (callback) => callback(),
}));

const { AgentRunEvent } = require("../../models/agentRunEvent");

describe("AgentRunEvent trace snapshots", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns recent activity, input lifecycle, and resource events in sequence order", async () => {
    mockFindMany
      .mockResolvedValueOnce([
        {
          sequence: 10,
          run_id: "run-1",
          version: 2,
          type: "input.resolved",
          payload: '{"requestId":"question-1"}',
          createdAt: new Date("2026-08-28T00:00:10Z"),
        },
        {
          sequence: 8,
          run_id: "run-1",
          version: 2,
          type: "activity.updated",
          payload: '{"summary":"Working"}',
          createdAt: new Date("2026-08-28T00:00:08Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          sequence: 7,
          run_id: "run-1",
          version: 2,
          type: "skill.activated",
          payload: '{"name":"3gpp-review"}',
          createdAt: new Date("2026-08-28T00:00:07Z"),
        },
        {
          sequence: 4,
          run_id: "run-1",
          version: 2,
          type: "context.rag.recalled",
          payload: '{"count":2}',
          createdAt: new Date("2026-08-28T00:00:04Z"),
        },
      ]);

    const events = await AgentRunEvent.traceSnapshot("run-1");

    expect(events.map((event) => event.type)).toEqual([
      "context.rag.recalled",
      "skill.activated",
      "activity.updated",
      "input.resolved",
    ]);
    expect(mockFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          run_id: "run-1",
          type: expect.objectContaining({
            in: expect.arrayContaining([
              "activity.updated",
              "input.requested",
              "input.resolved",
              "run.started",
            ]),
          }),
        }),
      })
    );
    expect(mockFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          run_id: "run-1",
          type: expect.objectContaining({
            in: expect.arrayContaining([
              "context.memory.updated",
              "context.rag.recalled",
              "skill.activated",
            ]),
          }),
        }),
      })
    );
  });
});
