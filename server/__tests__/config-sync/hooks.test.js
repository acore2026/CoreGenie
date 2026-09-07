const mockScan = jest.fn();
jest.mock("../../config-sync/engine", () => ({
  hash: () => "test",
  Synchronizer: jest
    .fn()
    .mockImplementation(() => ({ exclusive: (fn) => fn(), scan: mockScan })),
}));
jest.mock("../../utils/prisma", () => ({}));
const { synchronizeWrites } = require("../../config-sync");

describe("web configuration saves", () => {
  let previousEnabled, previousDirectory;
  beforeEach(() => {
    previousEnabled = process.env.AGENT_CONFIG_SYNC_ENABLED;
    previousDirectory = process.env.AGENT_CONFIG_SYNC_DIR;
    process.env.AGENT_CONFIG_SYNC_ENABLED = "true";
    process.env.AGENT_CONFIG_SYNC_DIR = "/tmp/config-sync-hook-test";
    mockScan.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    if (previousEnabled === undefined)
      delete process.env.AGENT_CONFIG_SYNC_ENABLED;
    else process.env.AGENT_CONFIG_SYNC_ENABLED = previousEnabled;
    if (previousDirectory === undefined)
      delete process.env.AGENT_CONFIG_SYNC_DIR;
    else process.env.AGENT_CONFIG_SYNC_DIR = previousDirectory;
  });
  it("reconciles immediately after a web save", async () => {
    const saved = [];
    const model = {
      update: async (value) => {
        saved.push(value);
        return { success: true };
      },
    };
    mockScan.mockImplementation(async () => expect(saved).toEqual(["edit"]));
    synchronizeWrites(model, ["update"]);
    await expect(model.update("edit")).resolves.toEqual({ success: true });
    expect(mockScan).toHaveBeenCalledTimes(1);
  });
  it("preserves a successful database save if the file export fails", async () => {
    const model = { update: async () => ({ success: true }) };
    mockScan.mockRejectedValue(new Error("directory unavailable"));
    synchronizeWrites(model, ["update"]);
    await expect(model.update()).resolves.toEqual({ success: true });
  });
  it("does not re-enter reconciliation for nested saves", async () => {
    const model = {
      inner: async () => "saved",
      outer: async function () {
        return this.inner();
      },
    };
    synchronizeWrites(model, ["inner", "outer"]);
    expect(await model.outer()).toBe("saved");
    expect(mockScan).toHaveBeenCalledTimes(1);
  });
  it("leaves unrelated settings and disabled installations alone", async () => {
    const model = { update: jest.fn(async () => true) };
    synchronizeWrites(model, ["update"], (value) => value === "prompt");
    await model.update("other setting");
    process.env.AGENT_CONFIG_SYNC_ENABLED = "false";
    await model.update("prompt");
    expect(model.update).toBeDefined();
    expect(mockScan).not.toHaveBeenCalled();
  });
});
