/* eslint-env jest, node */
const mockMemory = {
  globalForUser: jest.fn(),
  forUserWorkspace: jest.fn(),
  updateLastUsed: jest.fn(),
  create: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
};

jest.mock("../../models/memory", () => ({ Memory: mockMemory }));

const {
  recallMemory,
  storeMemory,
  deleteMemory,
} = require("../../tools/memory");

function context() {
  return {
    user: { id: 7 },
    workspace: { id: 11 },
    emit: jest.fn().mockResolvedValue(undefined),
  };
}

describe("memory tool context events", () => {
  beforeEach(() => jest.clearAllMocks());

  it("emits the scopes and count when memory is recalled", async () => {
    mockMemory.globalForUser.mockResolvedValue([{ id: 1, scope: "global" }]);
    mockMemory.forUserWorkspace.mockResolvedValue([
      { id: 2, scope: "workspace" },
    ]);
    const ctx = context();

    await recallMemory.execute({}, ctx);

    expect(ctx.emit).toHaveBeenCalledWith("context.memory.recalled", {
      memories: [
        { id: 1, scope: "global" },
        { id: 2, scope: "workspace" },
      ],
      count: 2,
    });
  });

  it("emits a durable update after storing memory", async () => {
    mockMemory.create.mockResolvedValue({
      memory: { id: 3, scope: "workspace", content: "Remember this" },
      message: null,
    });
    const ctx = context();

    await storeMemory.execute(
      { content: "Remember this", scope: "workspace" },
      ctx
    );

    expect(ctx.emit).toHaveBeenCalledWith("context.memory.updated", {
      action: "stored",
      count: 1,
      memoryId: 3,
      scope: "workspace",
    });
  });

  it("emits a durable update after deleting memory", async () => {
    mockMemory.get.mockResolvedValue({ id: 4, scope: "global" });
    mockMemory.delete.mockResolvedValue(true);
    const ctx = context();

    await deleteMemory.execute({ id: 4 }, ctx);

    expect(ctx.emit).toHaveBeenCalledWith("context.memory.updated", {
      action: "deleted",
      count: 1,
      memoryId: 4,
      scope: "global",
    });
  });
});
