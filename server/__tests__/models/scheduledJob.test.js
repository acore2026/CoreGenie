/* eslint-env jest, node */
const mockPrisma = {
  scheduled_jobs: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(async (operation) => operation(mockPrisma)),
};

jest.mock("../../utils/prisma", () => mockPrisma);

const { ScheduledJob } = require("../../models/scheduledJob");

describe("ScheduledJob structured schedules", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stores the visual rule and computes the first run", async () => {
    mockPrisma.scheduled_jobs.create.mockImplementation(async ({ data }) => ({
      id: 12,
      ...data,
    }));
    const scheduleConfig = {
      type: "once",
      date: "2030-01-02",
      time: "09:30",
      timezone: "Asia/Shanghai",
      scheduledAt: "2030-01-02T01:30:00.000Z",
    };

    const { job, error } = await ScheduledJob.create({
      name: "整理提案",
      prompt: "下载并整理提案。",
      scheduleType: "once",
      scheduleConfig,
      timezone: "Asia/Shanghai",
      workspace_id: 8,
      agent_id: 3,
      created_by: 5,
    });

    expect(error).toBeNull();
    expect(job.nextRunAt.toISOString()).toBe("2030-01-02T01:30:00.000Z");
    expect(mockPrisma.scheduled_jobs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduleType: "once",
        scheduleConfig: JSON.stringify(scheduleConfig),
        workspace_id: 8,
        agent_id: 3,
        created_by: 5,
      }),
    });
  });

  it("atomically disables a one-time rule before it is enqueued", async () => {
    const due = new Date("2030-01-02T01:30:00.000Z");
    mockPrisma.scheduled_jobs.findFirst.mockResolvedValue({
      id: 12,
      enabled: true,
      scheduleType: "once",
      nextRunAt: due,
    });
    mockPrisma.scheduled_jobs.update.mockImplementation(
      async ({ data }) => ({ id: 12, ...data })
    );

    const claimed = await ScheduledJob.claimScheduledTrigger(
      12,
      new Date("2030-01-02T01:30:01.000Z")
    );

    expect(claimed).toMatchObject({ enabled: false, nextRunAt: null });
    expect(mockPrisma.scheduled_jobs.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({ enabled: false, nextRunAt: null }),
    });
  });

  it("advances a recurring rule when claiming the due trigger", async () => {
    const now = new Date("2030-01-02T01:30:01.000Z");
    mockPrisma.scheduled_jobs.findFirst.mockResolvedValue({
      id: 13,
      enabled: true,
      schedule: "",
      scheduleType: "recurring",
      scheduleConfig: JSON.stringify({
        type: "recurring",
        frequency: "daily",
        time: "09:30",
        timezone: "Asia/Shanghai",
      }),
      nextRunAt: new Date("2030-01-02T01:30:00.000Z"),
    });
    mockPrisma.scheduled_jobs.update.mockImplementation(
      async ({ data }) => ({ id: 13, enabled: true, ...data })
    );

    const claimed = await ScheduledJob.claimScheduledTrigger(13, now);

    expect(claimed.nextRunAt.toISOString()).toBe(
      "2030-01-03T01:30:00.000Z"
    );
  });

  it("can defer a one-time trigger when another run is still active", async () => {
    mockPrisma.scheduled_jobs.update.mockImplementation(
      async ({ data }) => ({ id: 12, ...data })
    );

    const deferred = await ScheduledJob.deferOneTimeTrigger(12, 30_000);

    expect(deferred.enabled).toBe(true);
    expect(deferred.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });
});
