const mockPrisma = {
  workspace_threads: { updateMany: jest.fn(), findFirst: jest.fn() },
};
const mockInvoke = jest.fn();
jest.mock("../../utils/prisma", () => mockPrisma);
jest.mock("../../models/workspaceChats", () => ({
  WorkspaceChats: { get: jest.fn() },
}));
jest.mock("../../resources/models", () => ({
  createLightweightChatModel: jest.fn(async () => ({ invoke: mockInvoke })),
}));
jest.mock("../../utils/helpers", () => ({
  stripThinkingFromText: (value) => value,
}));
const { WorkspaceThread } = require("../../models/workspaceThread");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { createLightweightChatModel } = require("../../resources/models");

let row;
const opts = () => ({
  workspace: { id: 1 },
  thread: { id: 9, name: "Thread", slug: "test" },
  prompt: "请比较这两份提案的技术差异",
  onRename: jest.fn(),
});
beforeEach(() => {
  jest.clearAllMocks();
  row = { id: 9, name: "Thread", slug: "test" };
  WorkspaceChats.get.mockResolvedValue(null);
  mockPrisma.workspace_threads.findFirst.mockImplementation(async () => ({
    ...row,
  }));
  mockPrisma.workspace_threads.updateMany.mockImplementation(
    async ({ where, data }) => {
      if (row.name !== where.name) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    }
  );
  mockInvoke.mockResolvedValue({ content: "提案技术对比" });
});
it("publishes a provisional title without waiting for a model or first response", async () => {
  let finish;
  mockInvoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const options = opts();
  const pending = WorkspaceThread.autoRenameThread(options);
  await new Promise(setImmediate);
  expect(options.onRename).toHaveBeenCalledWith(
    expect.objectContaining({ name: options.prompt })
  );
  expect(row.name).toBe(options.prompt);
  finish({ content: "提案技术对比" });
  await pending;
  expect(row.name).toBe("提案技术对比");
  expect(mockInvoke.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(createLightweightChatModel).toHaveBeenCalledWith(
    expect.objectContaining({ maxTokens: 64, thinking: false })
  );
});
it("keeps a manual rename made during refinement", async () => {
  mockInvoke.mockImplementation(async () => {
    row.name = "我的研究";
    return { content: "自动标题" };
  });
  const options = opts();
  await WorkspaceThread.autoRenameThread(options);
  expect(row.name).toBe("我的研究");
  expect(options.onRename).toHaveBeenCalledTimes(1);
});
it("only one concurrent request claims the default name", async () => {
  await Promise.all([
    WorkspaceThread.autoRenameThread(opts()),
    WorkspaceThread.autoRenameThread(opts()),
  ]);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
});
it("keeps the provisional title when the model fails or times out", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  mockInvoke.mockRejectedValue(new Error("timed out"));
  await WorkspaceThread.autoRenameThread(opts());
  expect(row.name).toBe(opts().prompt);
  log.mockRestore();
});
it("uses the first saved prompt instead of a later incoming prompt", async () => {
  WorkspaceChats.get.mockResolvedValue({
    prompt: "最初的问题",
    response: JSON.stringify({ text: "最初的回答" }),
  });
  await WorkspaceThread.autoRenameThread(opts());
  expect(mockInvoke.mock.calls[0][0][1].content).toContain("最初的问题");
  expect(mockInvoke.mock.calls[0][0][1].content).not.toContain(opts().prompt);
});
it("does not rename manually named or empty threads", async () => {
  await WorkspaceThread.autoRenameThread({
    ...opts(),
    thread: { ...row, name: "用户标题" },
  });
  await WorkspaceThread.autoRenameThread({ ...opts(), prompt: "" });
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(mockPrisma.workspace_threads.updateMany).not.toHaveBeenCalled();
});

it("claims a prompt that equals the default name only once", async () => {
  mockInvoke.mockResolvedValue({ content: "Thread" });
  await Promise.all([
    WorkspaceThread.autoRenameThread({ ...opts(), prompt: "Thread" }),
    WorkspaceThread.autoRenameThread({ ...opts(), prompt: "Thread" }),
  ]);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(row.name).not.toBe(WorkspaceThread.defaultName);
});
