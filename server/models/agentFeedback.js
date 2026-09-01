const { v4: uuidv4 } = require("uuid");
const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

const VALID_RATINGS = new Set(["good", "neutral", "bad"]);
const MAX_COMMENT_LENGTH = 500;
const MAX_ACTIVE_REASONS = 12;
const MAX_REASON_CODE_LENGTH = 23;
const REASON_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeReason(reason) {
  if (!reason) return null;
  return {
    id: reason.id,
    code: reason.code,
    label: reason.label,
    enabled: reason.enabled,
    sortOrder: reason.sortOrder,
  };
}

function normalizeFeedback(feedback) {
  if (!feedback || feedback.deletedAt) return null;
  return {
    rating: feedback.rating,
    reasonCodes: safeJsonParse(feedback.reasons, []).map(
      (reason) => reason.code
    ),
    reasons: safeJsonParse(feedback.reasons, []),
    comment: feedback.comment || "",
  };
}

const AgentFeedbackReason = {
  list: async function ({ enabledOnly = true } = {}) {
    const reasons = await prisma.agent_feedback_reasons.findMany({
      where: enabledOnly ? { enabled: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return reasons.map(normalizeReason);
  },

  getByCodes: async function (codes = [], { includeDisabled = false } = {}) {
    const normalizedCodes = [...new Set(codes.map(String))];
    if (!normalizedCodes.length) return [];
    const reasons = await prisma.agent_feedback_reasons.findMany({
      where: {
        code: { in: normalizedCodes },
        ...(includeDisabled ? {} : { enabled: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return reasons.map(normalizeReason);
  },

  create: async function ({ code, label, createdBy = null }) {
    const normalizedCode = String(code || "")
      .trim()
      .toLowerCase();
    const normalizedLabel = String(label || "").trim();
    if (
      !REASON_CODE_PATTERN.test(normalizedCode) ||
      normalizedCode.length > MAX_REASON_CODE_LENGTH
    )
      return {
        reason: null,
        error: `原因代码只能使用小写字母、数字和连字符，最多 ${MAX_REASON_CODE_LENGTH} 个字符。`,
      };
    if (!normalizedLabel || normalizedLabel.length > 40)
      return { reason: null, error: "原因名称需要为 1 至 40 个字符。" };
    const activeCount = await prisma.agent_feedback_reasons.count({
      where: { enabled: true },
    });
    if (activeCount >= MAX_ACTIVE_REASONS)
      return {
        reason: null,
        error: `最多启用 ${MAX_ACTIVE_REASONS} 个评价原因。`,
      };

    const last = await prisma.agent_feedback_reasons.findFirst({
      orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    });
    try {
      const reason = await prisma.agent_feedback_reasons.create({
        data: {
          code: normalizedCode,
          label: normalizedLabel,
          sortOrder: (last?.sortOrder || 0) + 10,
          createdBy: createdBy ? Number(createdBy) : null,
        },
      });
      return { reason: normalizeReason(reason), error: null };
    } catch (error) {
      if (error.code === "P2002")
        return { reason: null, error: "这个原因代码已经存在。" };
      throw error;
    }
  },

  update: async function (id, updates = {}) {
    const current = await prisma.agent_feedback_reasons.findUnique({
      where: { id: Number(id) },
    });
    if (!current) return { reason: null, error: "评价原因不存在。" };

    const data = { lastUpdatedAt: new Date() };
    if (Object.hasOwn(updates, "label")) {
      const label = String(updates.label || "").trim();
      if (!label || label.length > 40)
        return { reason: null, error: "原因名称需要为 1 至 40 个字符。" };
      data.label = label;
    }
    if (Object.hasOwn(updates, "sortOrder")) {
      const sortOrder = Number(updates.sortOrder);
      if (!Number.isInteger(sortOrder))
        return { reason: null, error: "排序值无效。" };
      data.sortOrder = sortOrder;
    }
    if (Object.hasOwn(updates, "enabled")) {
      if (current.code === "other" && updates.enabled === false)
        return { reason: null, error: "“其他”不能停用。" };
      if (!current.enabled && updates.enabled === true) {
        const activeCount = await prisma.agent_feedback_reasons.count({
          where: { enabled: true },
        });
        if (activeCount >= MAX_ACTIVE_REASONS)
          return {
            reason: null,
            error: `最多启用 ${MAX_ACTIVE_REASONS} 个评价原因。`,
          };
      }
      data.enabled = Boolean(updates.enabled);
    }

    const reason = await prisma.agent_feedback_reasons.update({
      where: { id: current.id },
      data,
    });
    return { reason: normalizeReason(reason), error: null };
  },
};

const AgentResponseFeedback = {
  get: async function (id) {
    return prisma.agent_response_feedback.findUnique({
      where: { id: String(id) },
    });
  },

  getRecordForChat: async function (chatId) {
    return prisma.agent_response_feedback.findUnique({
      where: { chat_id: Number(chatId) },
    });
  },

  getForChat: async function (chatId) {
    return normalizeFeedback(await this.getRecordForChat(chatId));
  },

  whereChatIds: async function (chatIds = []) {
    const ids = [...new Set(chatIds.map(Number).filter(Number.isInteger))];
    if (!ids.length) return new Map();
    const rows = await prisma.agent_response_feedback.findMany({
      where: { chat_id: { in: ids }, deletedAt: null },
    });
    return new Map(rows.map((row) => [row.chat_id, normalizeFeedback(row)]));
  },

  upsert: async function ({
    chat,
    runId,
    agentId = null,
    rating,
    reasons = [],
    comment = "",
    chatUpdate = null,
  }) {
    const reasonSnapshot = reasons.map(({ code, label }) => ({ code, label }));
    const now = new Date();
    const save = async (database) => {
      const feedback = await database.agent_response_feedback.upsert({
        where: { chat_id: Number(chat.id) },
        create: {
          id: uuidv4(),
          chat_id: Number(chat.id),
          run_id: String(runId),
          workspace_id: Number(chat.workspaceId),
          user_id: chat.user_id ? Number(chat.user_id) : null,
          agent_id: agentId ? Number(agentId) : null,
          rating,
          reasons: JSON.stringify(reasonSnapshot),
          comment: comment || null,
          syncStatus: "pending",
        },
        update: {
          run_id: String(runId),
          agent_id: agentId ? Number(agentId) : null,
          rating,
          reasons: JSON.stringify(reasonSnapshot),
          comment: comment || null,
          deletedAt: null,
          syncStatus: "pending",
          syncError: null,
          lastUpdatedAt: now,
        },
      });
      if (chatUpdate)
        await database.workspace_chats.update({
          where: { id: Number(chat.id) },
          data: chatUpdate,
        });
      return feedback;
    };
    const feedback = chatUpdate
      ? await prisma.$transaction(save)
      : await save(prisma);
    return { record: feedback, feedback: normalizeFeedback(feedback) };
  },

  remove: async function (chatId, { chatUpdate = null } = {}) {
    const remove = async (database) => {
      const existing = await database.agent_response_feedback.findUnique({
        where: { chat_id: Number(chatId) },
      });
      const feedback = existing
        ? await database.agent_response_feedback.update({
            where: { chat_id: Number(chatId) },
            data: {
              deletedAt: new Date(),
              syncStatus: "pending",
              syncError: null,
              lastUpdatedAt: new Date(),
            },
          })
        : null;
      if (chatUpdate)
        await database.workspace_chats.update({
          where: { id: Number(chatId) },
          data: chatUpdate,
        });
      return feedback;
    };
    return chatUpdate ? prisma.$transaction(remove) : remove(prisma);
  },

  pending: async function (take = 50) {
    return prisma.agent_response_feedback.findMany({
      where: { syncStatus: { in: ["pending", "error"] } },
      orderBy: { lastUpdatedAt: "asc" },
      take,
    });
  },

  markSynced: async function (id) {
    return prisma.agent_response_feedback.update({
      where: { id: String(id) },
      data: {
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date(),
        lastUpdatedAt: new Date(),
      },
    });
  },

  markSyncError: async function (id, error) {
    return prisma.agent_response_feedback.update({
      where: { id: String(id) },
      data: {
        syncStatus: "error",
        syncAttempts: { increment: 1 },
        syncError: String(error || "Langfuse sync failed").slice(0, 1_000),
        lastUpdatedAt: new Date(),
      },
    });
  },
};

module.exports = {
  AgentFeedbackReason,
  AgentResponseFeedback,
  MAX_ACTIVE_REASONS,
  MAX_COMMENT_LENGTH,
  MAX_REASON_CODE_LENGTH,
  REASON_CODE_PATTERN,
  VALID_RATINGS,
  normalizeFeedback,
};
