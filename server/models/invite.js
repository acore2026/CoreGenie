const { safeJsonParse } = require("../utils/http");
const prisma = require("../utils/prisma");

const Invite = {
  isActive: (invite = null) =>
    Boolean(invite) && ["pending", "claimed"].includes(invite.status),

  makeCode: () => {
    const uuidAPIKey = require("uuid-apikey");
    return uuidAPIKey.create().apiKey;
  },

  create: async function ({ createdByUserId = 0, workspaceIds = [] }) {
    try {
      const invite = await prisma.invites.create({
        data: {
          code: this.makeCode(),
          createdBy: createdByUserId,
          workspaceIds: JSON.stringify(workspaceIds),
        },
      });
      return { invite, error: null };
    } catch (error) {
      console.error("FAILED TO CREATE INVITE.", error.message);
      return { invite: null, error: error.message };
    }
  },

  getOrCreateWorkspaceInvite: async function ({
    createdByUserId,
    workspaceId,
  }) {
    const workspaceIds = JSON.stringify([Number(workspaceId)]);
    const existing = await this.get({
      createdBy: Number(createdByUserId),
      workspaceIds,
      status: { in: ["pending", "claimed"] },
    });
    if (existing) return { invite: existing, error: null };
    return this.create({
      createdByUserId: Number(createdByUserId),
      workspaceIds: [Number(workspaceId)],
    });
  },

  workspaceDetails: async function (invite = null) {
    if (!invite?.workspaceIds) return [];
    const { Workspace } = require("./workspace");
    const workspaceIds = safeJsonParse(invite.workspaceIds, [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id));
    if (workspaceIds.length === 0) return [];

    const workspaces = await Workspace.where({ id: { in: workspaceIds } });
    return workspaces.map(({ id, name, slug }) => ({ id, name, slug }));
  },

  deactivate: async function (inviteId = null) {
    try {
      const invite = await prisma.invites.findUnique({
        where: { id: Number(inviteId) },
      });
      if (!invite) return { success: false, error: "Invite not found" };

      await prisma.invites.update({
        where: { id: Number(inviteId) },
        data: { status: "disabled" },
      });
      return { success: true, error: null };
    } catch (error) {
      console.error(error.message);
      return { success: false, error: "Failed to deactivate invite" };
    }
  },

  applyToUser: async function (inviteId = null, user) {
    try {
      const invite = await prisma.invites.findUnique({
        where: { id: Number(inviteId) },
      });
      if (!this.isActive(invite))
        return { success: false, error: "Invite is no longer valid." };

      try {
        if (!!invite?.workspaceIds) {
          const { Workspace } = require("./workspace");
          const { WorkspaceUser } = require("./workspaceUsers");
          const workspaceIds = (await Workspace.where({})).map(
            (workspace) => workspace.id
          );
          const ids = safeJsonParse(invite.workspaceIds)
            .map((id) => Number(id))
            .filter((id) => workspaceIds.includes(id));
          const existingMemberships = await WorkspaceUser.where({
            user_id: user.id,
            workspace_id: { in: ids },
          });
          const existingWorkspaceIds = new Set(
            existingMemberships.map(({ workspace_id }) => workspace_id)
          );
          const missingWorkspaceIds = ids.filter(
            (id) => !existingWorkspaceIds.has(id)
          );
          if (missingWorkspaceIds.length !== 0)
            await WorkspaceUser.createMany(user.id, missingWorkspaceIds);
        }
      } catch (e) {
        console.error(
          "Could not add user to workspaces automatically",
          e.message
        );
      }

      return { success: true, error: null };
    } catch (error) {
      console.error(error.message);
      return { success: false, error: error.message };
    }
  },

  // Backwards-compatible alias for callers outside the web application. An
  // invite is now reusable, so applying it no longer marks it as claimed.
  markClaimed: async function (inviteId = null, user) {
    return this.applyToUser(inviteId, user);
  },

  get: async function (clause = {}) {
    try {
      const invite = await prisma.invites.findFirst({ where: clause });
      return invite || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  count: async function (clause = {}) {
    try {
      const count = await prisma.invites.count({ where: clause });
      return count;
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  delete: async function (clause = {}) {
    try {
      await prisma.invites.deleteMany({ where: clause });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  where: async function (clause = {}, limit) {
    try {
      const invites = await prisma.invites.findMany({
        where: clause,
        take: limit || undefined,
      });
      return invites;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  whereWithUsers: async function (clause = {}, limit) {
    const { User } = require("./user");
    try {
      const invites = await this.where(clause, limit);
      for (const invite of invites) {
        // Older single-use links were stored as claimed. They are reusable now
        // and remain active until an administrator explicitly disables them.
        if (invite.status === "claimed") invite.status = "pending";

        if (invite.claimedBy) {
          const acceptedUser = await User.get({ id: invite.claimedBy });
          invite.claimedBy = {
            id: acceptedUser?.id,
            username: acceptedUser?.username,
          };
        }

        if (invite.createdBy) {
          const createdUser = await User.get({ id: invite.createdBy });
          invite.createdBy = {
            id: createdUser?.id,
            username: createdUser?.username,
          };
        }
      }
      return invites;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },
};

module.exports = { Invite };
