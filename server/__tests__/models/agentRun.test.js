// AgentRun.create 依赖 prisma 单例，这里在加载前替换掉它的依赖。
const mockPrisma = {
  agent_runs: {
    create: jest.fn(),
  },
};
const mockWithPrismaRetry = jest.fn((fn) => fn());

jest.mock("../../utils/prisma", () => mockPrisma, { virtual: true });
jest.mock("../../utils/prismaRetry", () => ({
  withPrismaRetry: mockWithPrismaRetry,
}));

const { AgentRun } = require("../../models/agentRun");

describe("AgentRun.create", () => {
  beforeEach(() => {
    mockPrisma.agent_runs.create.mockReset();
    mockPrisma.agent_runs.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data })
    );
    mockWithPrismaRetry.mockClear();
  });

  test("未显式传 id 时 checkpointThreadId 使用生成的 runId 而不是 null", async () => {
    const run = await AgentRun.create({
      workspaceId: 1,
      prompt: "测试",
    });
    expect(run.checkpointThreadId).toMatch(/^agent-run:[0-9a-f-]{36}$/);
    expect(run.checkpointThreadId).toBe(`agent-run:${run.id}`);
    expect(run.id).not.toBeNull();
  });

  test("显式传 id 时 checkpointThreadId 使用该 id", async () => {
    const run = await AgentRun.create({
      id: "11111111-2222-3333-4444-555555555555",
      workspaceId: 1,
      prompt: "测试",
    });
    expect(run.checkpointThreadId).toBe(
      "agent-run:11111111-2222-3333-4444-555555555555"
    );
  });

  test("evidence-research 运行时使用 custom 线程前缀", async () => {
    const run = await AgentRun.create({
      workspaceId: 1,
      prompt: "测试",
      runtimeKey: "evidence-research",
      runtimeVersion: 2,
    });
    expect(run.checkpointThreadId).toMatch(/^custom:2:[0-9a-f-]{36}$/);
  });
});
