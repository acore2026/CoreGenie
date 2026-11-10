const prisma = require("../utils/prisma");

const TABLES = {
  agents: "predefined_agents",
  "quick-tasks": "predefined_quick_tasks",
  commands: "slash_command_presets",
};

function sortItems(items, ids) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
  );
}

const DisplayOrder = {
  async ids(kind) {
    const record = await prisma.system_settings.findUnique({
      where: { label: `display_order_${kind}` },
    });
    try {
      const ids = JSON.parse(record?.value || "[]");
      return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
    } catch {
      return [];
    }
  },
  async apply(kind, items) {
    return sortItems(items, await this.ids(kind));
  },
  async save(kind, ids) {
    if (
      !TABLES[kind] ||
      !Array.isArray(ids) ||
      ids.length > 10000 ||
      ids.some((id) => !Number.isInteger(id) || id < 1) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("显示顺序无效，请刷新后重试。");
    const records = await prisma[TABLES[kind]].findMany({
      where: { id: { in: ids }, ...(kind === "commands" ? { uid: 0 } : {}) },
      select: { id: true },
    });
    if (records.length !== ids.length)
      throw new Error("列表已发生变化，请刷新后重新排序。");
    await prisma.system_settings.upsert({
      where: { label: `display_order_${kind}` },
      create: { label: `display_order_${kind}`, value: JSON.stringify(ids) },
      update: { value: JSON.stringify(ids), lastUpdatedAt: new Date() },
    });
  },
};

module.exports = { DisplayOrder, sortItems };
