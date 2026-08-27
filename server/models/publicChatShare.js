const crypto = require("crypto");
const prisma = require("../utils/prisma");

const PublicChatShare = {
  newToken: function () {
    return crypto.randomBytes(32).toString("base64url");
  },

  get: async function (clause = {}) {
    try {
      return await prisma.public_chat_shares.findFirst({ where: clause });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  createOrGet: async function ({
    workspaceId,
    threadId = null,
    userId = null,
  }) {
    const scope = {
      workspace_id: Number(workspaceId),
      thread_id: threadId ? Number(threadId) : null,
      user_id: userId ? Number(userId) : null,
    };

    const existing = await this.get(scope);
    if (existing) return existing;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.public_chat_shares.create({
          data: { ...scope, token: this.newToken() },
        });
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  },
};

module.exports = { PublicChatShare };
