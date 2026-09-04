/* eslint-env jest, node */
const mockCreate = jest.fn();
const mockAddScheduledJob = jest.fn();

jest.mock("../../models/scheduledJob", () => ({
  ScheduledJob: {
    create: (...args) => mockCreate(...args),
    canActivate: jest.fn(async () => ({ allowed: true, limit: null })),
  },
}));
jest.mock("../../models/predefinedAgent", () => ({
  PredefinedAgent: {
    get: jest.fn(async (id) => ({ id: Number(id), name: "研究助手" })),
    all: jest.fn(async () => []),
  },
}));
jest.mock("../../utils/BackgroundWorkers", () => ({
  BackgroundService: class BackgroundService {
    addScheduledJob(...args) {
      return mockAddScheduledJob(...args);
    }
  },
}));

const { createScheduledJob } = require("../../tools/schedule");

describe("schedule.create", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      job: {
        id: 17,
        name: "整理会议文稿",
        nextRunAt: new Date("2030-01-02T01:30:00.000Z"),
      },
      error: null,
    });
  });

  it("creates a structured job in the current workspace", async () => {
    const result = await createScheduledJob.execute(
      {
        name: "整理会议文稿",
        prompt: "下载并整理本次会议文稿。",
        agentId: 3,
        scheduleConfig: {
          type: "once",
          date: "2030-01-02",
          time: "09:30",
          timezone: "Asia/Shanghai",
        },
      },
      {
        workspace: { id: 8, slug: "sa2" },
        user: { id: 5 },
        agent: { id: 2 },
        run: { source: "chat" },
      }
    );

    expect(result.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 8,
        agent_id: 3,
        created_by: 5,
        scheduleType: "once",
        timezone: "Asia/Shanghai",
      })
    );
    expect(mockAddScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 17 })
    );
  });

  it("does not create jobs from a scheduled run", async () => {
    const result = await createScheduledJob.execute(
      {
        name: "递归任务",
        prompt: "再创建一个任务。",
        scheduleConfig: {
          type: "recurring",
          frequency: "daily",
          time: "09:00",
          timezone: "Asia/Shanghai",
        },
      },
      {
        workspace: { id: 8, slug: "sa2" },
        agent: { id: 2 },
        run: { source: "scheduled" },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SCHEDULE_RECURSION_BLOCKED",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
