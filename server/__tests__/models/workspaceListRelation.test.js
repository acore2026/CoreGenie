/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  event_logs: { findMany: jest.fn() },
  workspace_users: { findMany: jest.fn() },
}));
const prisma = require("../../utils/prisma");
const {
  creatorFor,
  withWorkspaceListRelation,
} = require("../../models/workspaceListRelation");
const workspace = { id: 1, name: "改名后的工作区", createdAt: new Date(1000) };
const memberships = [
  { workspace_id: 1, user_id: 7, createdAt: new Date(1010) },
  { workspace_id: 1, user_id: 8, createdAt: new Date(100000) },
];
const log = {
  userId: 7,
  metadata: JSON.stringify({ workspaceName: "旧名字" }),
  occurredAt: new Date(1020),
};

it("identifies legacy creation after renaming with a corroborating original membership", () => {
  expect(creatorFor(workspace, [log], memberships)).toBe(7);
  expect(creatorFor(workspace, [log], memberships.slice(1))).toBeNull();
});
it("does not guess from membership alone or unrelated name matches", () => {
  expect(creatorFor(workspace, [], memberships)).toBeNull();
  expect(
    creatorFor(
      workspace,
      [{ ...log, occurredAt: new Date(100000) }],
      memberships
    )
  ).toBeNull();
  expect(
    creatorFor(
      workspace,
      [log, { ...log, userId: 8 }],
      [
        ...memberships,
        { workspace_id: 1, user_id: 8, createdAt: new Date(1011) },
      ]
    )
  ).toBeNull();
});
it("uses explicit workspace IDs even when the creator is no longer a member", () => {
  expect(
    creatorFor(workspace, [{ ...log, metadata: '{"workspaceId":1}' }], [])
  ).toBe(7);
  expect(
    creatorFor(
      workspace,
      [{ ...log, metadata: '{"workspaceId":2}' }],
      memberships
    )
  ).toBeNull();
});
it("distinguishes creator, invited member, and unrelated administrator visibility", async () => {
  prisma.event_logs.findMany.mockResolvedValue([log]);
  prisma.workspace_users.findMany.mockResolvedValue(memberships);
  for (const [id, relation] of [
    [7, "creator"],
    [8, "member"],
    [9, "other"],
  ])
    expect(
      (await withWorkspaceListRelation([workspace], { id }))[0].viewerRelation
    ).toBe(relation);
});
