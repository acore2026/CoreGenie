const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
let mockPrisma;
jest.mock(
  "../../utils/prisma",
  () => new Proxy({}, { get: (_target, key) => mockPrisma[key] })
);
const { updatePlan, planSchema } = require("../../tools/plan");
const { AgentRunTask } = require("../../models/agentRunTask");

const steps = () => [
  {
    id: "collect",
    title: "收集资料",
    status: "running",
    detail: "正在读取提案",
  },
  { id: "report", title: "生成报告", status: "pending", detail: "" },
];
const context = (id = "run-one", extra = {}) => ({
  run: { id, runtimeKey: "default-react" },
  emit: jest.fn(),
  depth: 0,
  ...extra,
});

describe("ReAct progress plans", () => {
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "react-plan-"));
    mockPrisma = new PrismaClient({
      datasources: { db: { url: `file:${path.join(root, "test.db")}` } },
    });
    await mockPrisma.$executeRawUnsafe(
      "CREATE TABLE agent_runs (id TEXT PRIMARY KEY)"
    );
    await mockPrisma.$executeRawUnsafe(
      "INSERT INTO agent_runs (id) VALUES ('run-one'), ('run-two')"
    );
    const migration = await fs.readFile(
      path.resolve(
        __dirname,
        "../../prisma/migrations/20260827150000_governed_agent_runtime/migration.sql"
      ),
      "utf8"
    );
    await mockPrisma.$executeRawUnsafe(
      migration.match(/CREATE TABLE "agent_run_tasks" \([\s\S]*?\);/)[0]
    );
  });
  afterEach(async () => {
    await mockPrisma.$disconnect();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("persists progress, preserves order and emits updates for the card", async () => {
    const ctx = context();
    await updatePlan.execute({ tasks: steps() }, ctx);
    expect(ctx.emit).toHaveBeenCalledWith(
      "plan.updated",
      expect.objectContaining({
        planKind: "progress",
        tasks: expect.arrayContaining([
          expect.objectContaining({ status: "running", title: "收集资料" }),
        ]),
      })
    );
    const next = steps();
    next[0].status = "completed";
    next[1].status = "running";
    await updatePlan.execute({ tasks: next }, ctx);
    const saved = await AgentRunTask.list("run-one");
    expect(saved.map((task) => task.status)).toEqual(["completed", "running"]);
    expect(saved[0].completedAt).toBeTruthy();
    expect(saved[1].budget.planOrder).toBe(1);
    await updatePlan.execute({ tasks: next }, ctx);
    expect(await mockPrisma.agent_run_tasks.count()).toBe(2);
  });
  it("keeps runs isolated and does not erase earlier work", async () => {
    await updatePlan.execute({ tasks: steps() }, context());
    await updatePlan.execute({ tasks: steps() }, context("run-two"));
    expect(await mockPrisma.agent_run_tasks.count()).toBe(4);
    await expect(
      updatePlan.execute({ tasks: [steps()[1]] }, context())
    ).rejects.toThrow("保留已有任务");
    expect(await AgentRunTask.list("run-one")).toHaveLength(2);
    await AgentRunTask.reconcileTerminal("run-one", "cancelled");
    expect(
      (await AgentRunTask.list("run-one")).every(
        (task) => task.status === "cancelled"
      )
    ).toBe(true);
    expect((await AgentRunTask.list("run-two"))[0].status).toBe("running");
  });
  it("rejects duplicate IDs, parallel active steps and oversized plans", () => {
    expect(
      planSchema.safeParse({ tasks: [steps()[0], steps()[0]] }).success
    ).toBe(false);
    expect(
      planSchema.safeParse({
        tasks: steps().map((step) => ({ ...step, status: "running" })),
      }).success
    ).toBe(false);
    expect(
      planSchema.safeParse({
        tasks: Array.from({ length: 13 }, (_, i) => ({
          ...steps()[0],
          id: `step${i}`,
          status: "pending",
        })),
      }).success
    ).toBe(false);
  });
  it("does not let workers or other runtimes replace the user's plan", async () => {
    for (const ctx of [
      context("run-one", { depth: 1 }),
      context("run-one", { taskId: "worker" }),
      context("run-one", {
        run: { id: "run-one", runtimeKey: "governed-agent" },
      }),
    ]) {
      expect((await updatePlan.execute({ tasks: steps() }, ctx)).ok).toBe(
        false
      );
      expect(ctx.emit).not.toHaveBeenCalled();
    }
    expect(await mockPrisma.agent_run_tasks.count()).toBe(0);
  });
});
