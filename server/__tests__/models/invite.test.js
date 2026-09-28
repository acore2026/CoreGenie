jest.mock("../../utils/prisma", () => ({
  invites: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
}));

jest.mock("../../models/workspace", () => ({
  Workspace: {
    where: jest.fn(),
  },
}));

jest.mock("../../models/workspaceUsers", () => ({
  WorkspaceUser: {
    where: jest.fn(),
    createMany: jest.fn(),
  },
}));

jest.mock("../../models/user", () => ({
  User: {
    get: jest.fn(),
  },
}));

const prisma = require("../../utils/prisma");
const { Invite } = require("../../models/invite");
const { Workspace } = require("../../models/workspace");
const { WorkspaceUser } = require("../../models/workspaceUsers");

describe("reusable invitations", () => {
  beforeEach(() => jest.clearAllMocks());

  it("treats pending and legacy claimed invitations as active", () => {
    expect(Invite.isActive({ status: "pending" })).toBe(true);
    expect(Invite.isActive({ status: "claimed" })).toBe(true);
    expect(Invite.isActive({ status: "disabled" })).toBe(false);
    expect(Invite.isActive(null)).toBe(false);
  });

  it("applies workspace access without consuming the invitation", async () => {
    prisma.invites.findUnique.mockResolvedValue({
      id: 12,
      status: "pending",
      workspaceIds: JSON.stringify([1, 2, 999]),
    });
    Workspace.where.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    WorkspaceUser.where.mockResolvedValue([]);
    const user = { id: 44 };

    const result = await Invite.applyToUser(12, user);

    expect(result).toEqual({ success: true, error: null });
    expect(WorkspaceUser.createMany).toHaveBeenCalledWith(44, [1, 2]);
    expect(prisma.invites.update).toBeUndefined();
  });

  it("normalizes legacy claimed links to active in admin results", async () => {
    prisma.invites.findMany.mockResolvedValue([
      {
        id: 9,
        code: "reusable-code",
        status: "claimed",
        claimedBy: null,
        createdBy: null,
      },
    ]);

    const invites = await Invite.whereWithUsers();

    expect(invites).toHaveLength(1);
    expect(invites[0].status).toBe("pending");
  });
});
