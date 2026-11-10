/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  system_settings: { findUnique: jest.fn(), upsert: jest.fn() },
  predefined_agents: { findMany: jest.fn() },
  predefined_quick_tasks: { findMany: jest.fn() },
  slash_command_presets: { findMany: jest.fn() },
}));
const prisma = require("../../utils/prisma");
const { DisplayOrder, sortItems } = require("../../models/displayOrder");

beforeEach(() => jest.resetAllMocks());

it("preserves fallback order, ignores removed IDs and appends new items", () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  expect(sortItems(items, [9, 3, 1])).toEqual([
    { id: 3 }, { id: 1 }, { id: 2 }, { id: 4 },
  ]);
  expect(items.map((item) => item.id)).toEqual([1, 2, 3, 4]);
  expect(sortItems(items, [])).toEqual(items);
});

it.each([null, "invalid JSON", "{}"])("uses existing order without a valid setting: %s", async (value) => {
  prisma.system_settings.findUnique.mockResolvedValue({ value });
  await expect(DisplayOrder.apply("agents", [{ id: 2 }, { id: 1 }])).resolves.toEqual([{ id: 2 }, { id: 1 }]);
});

it("persists and reloads installation order independently of agent configuration", async () => {
  prisma.predefined_agents.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  prisma.system_settings.upsert.mockImplementation(async ({ create }) => {
    prisma.system_settings.findUnique.mockResolvedValue(create);
  });
  await DisplayOrder.save("agents", [2, 1]);
  await expect(DisplayOrder.apply("agents", [{ id: 1 }, { id: 2 }])).resolves.toEqual([{ id: 2 }, { id: 1 }]);
  expect(prisma.system_settings.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { label: "display_order_agents" } }));
});

it.each([["invalid", []], ["agents", [1, 1]], ["agents", ["1"]], ["agents", [-1]], ["agents", null]])("rejects malformed order %s %j", async (kind, ids) => {
  await expect(DisplayOrder.save(kind, ids)).rejects.toThrow();
  expect(prisma.system_settings.upsert).not.toHaveBeenCalled();
});

it("rejects deleted items and only permits global slash commands", async () => {
  prisma.slash_command_presets.findMany.mockResolvedValue([]);
  await expect(DisplayOrder.save("commands", [7])).rejects.toThrow("列表已发生变化");
  expect(prisma.slash_command_presets.findMany).toHaveBeenCalledWith({ where: { id: { in: [7] }, uid: 0 }, select: { id: true } });
  expect(prisma.system_settings.upsert).not.toHaveBeenCalled();
});

it("applies roster and task order to the public Agent wizard without changing bindings", async () => {
  prisma.system_settings.findUnique.mockImplementation(async ({ where }) => ({
    value: JSON.stringify(where.label === "display_order_agents" ? [2, 1] : [20, 10]),
  }));
  prisma.predefined_agents.findMany.mockResolvedValue([
    { id: 1, quickTaskIds: "[10,20]" }, { id: 2, quickTaskIds: "[]" },
  ]);
  prisma.predefined_quick_tasks.findMany.mockResolvedValue([
    { id: 10, definition: '{"id":"download"}' },
    { id: 20, definition: '{"id":"compare"}' },
  ]);
  const { PredefinedAgent } = require("../../models/predefinedAgent");
  const agents = await PredefinedAgent.all();
  expect(agents.map((agent) => agent.id)).toEqual([2, 1]);
  expect(agents[1].quickTaskIds).toEqual([10, 20]);
  expect(agents[1].wizard.map((task) => task.id)).toEqual(["compare", "download"]);
  prisma.system_settings.findUnique.mockResolvedValue(null);
  const unsorted = await PredefinedAgent.all();
  expect(unsorted[0].wizard.map((task) => task.id)).toEqual(["download", "compare"]);
});

it("returns quick command presets in saved order", async () => {
  prisma.system_settings.findUnique.mockResolvedValue({ value: "[2,1]" });
  prisma.slash_command_presets.findMany.mockResolvedValue([
    { id: 1, command: "/compare" }, { id: 2, command: "/report" },
  ]);
  const { SlashCommandPresets } = require("../../models/slashCommandsPresets");
  expect((await SlashCommandPresets.getGlobalPresets()).map((item) => item.command)).toEqual(["/report", "/compare"]);
});
