const { z } = require("zod");
const { defineTool } = require("./descriptor");
const { GROUPS } = require("../utils/threeGppCatalog");
const { createCatalog } = require("../utils/globalReferenceCatalog");

const readCatalog = defineTool({
  id: "3gpp.catalog",
  name: "read_3gpp_catalog",
  description:
    "读取所有工作区共享的 3GPP 会议或议程目录。先按工作组读取会议，再用返回的会议 id 读取议程。目录由后台更新；pending 或 stale 时不可声称资料完整或最新。提案标题中的 KI 标记不是正式定义，会议目录也不代表会议结论。",
  action: false,
  schema: z.object({
    group: z.enum(GROUPS),
    meeting: z
      .string()
      .regex(/^[\w. -]{1,200}$/)
      .optional(),
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async ({ group, meeting, offset = 0, limit = 20 }) => {
    const data = await createCatalog().read(group, meeting);
    const field = meeting ? "items" : "meetings";
    const entries = data[field] || [];
    return {
      ...data,
      [field]: entries.slice(offset, offset + limit),
      total: entries.length,
      nextOffset: offset + limit < entries.length ? offset + limit : null,
    };
  },
});
module.exports = { readCatalog };
