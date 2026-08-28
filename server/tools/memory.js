const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { Memory } = require("../models/memory");

const recallMemory = defineTool({
  id: "memory.recall",
  name: "memory_recall",
  description:
    "Recall the user's personal global and current-workspace memories.",
  schema: z.object({}),
  action: false,
  execute: async (_args, context) => {
    const [global, workspace] = await Promise.all([
      Memory.globalForUser(context.user?.id),
      Memory.forUserWorkspace(context.user?.id, context.workspace.id),
    ]);
    const recalled = [...global, ...workspace];
    await Memory.updateLastUsed(recalled.map((item) => item.id));
    await context.emit("context.memory.recalled", {
      memories: recalled.map(({ id, scope }) => ({ id, scope })),
      count: recalled.length,
    });
    return { global, workspace };
  },
});

const storeMemory = defineTool({
  id: "memory.store",
  name: "memory_store",
  description:
    "Store a personal memory. Storage defaults to this workspace; choose global only when explicitly requested.",
  schema: z.object({
    content: z.string().min(1),
    scope: z.enum(["workspace", "global"]).default("workspace"),
  }),
  execute: async ({ content, scope }, context) => {
    const result = await Memory.create({
      userId: context.user?.id,
      workspaceId: scope === "global" ? null : context.workspace.id,
      scope,
      content,
    });
    if (!result.memory) throw new Error(result.message);
    await context.emit("context.memory.updated", {
      action: "stored",
      count: 1,
      memoryId: result.memory.id,
      scope: result.memory.scope,
    });
    return result.memory;
  },
});

const deleteMemory = defineTool({
  id: "memory.delete",
  name: "memory_delete",
  description:
    "Delete one of the current user's personal memories by its numeric ID.",
  schema: z.object({ id: z.number().int().positive() }),
  execute: async ({ id }, context) => {
    const owned = await Memory.get({ id, userId: context.user?.id ?? null });
    if (!owned) throw new Error("Memory not found.");
    if (!(await Memory.delete(id))) throw new Error("Memory deletion failed.");
    await context.emit("context.memory.updated", {
      action: "deleted",
      count: 1,
      memoryId: id,
      scope: owned.scope,
    });
    return { deleted: true, id };
  },
});

module.exports = { recallMemory, storeMemory, deleteMemory };
