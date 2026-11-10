const prisma = require("../utils/prisma");

function creatorFor(workspace, logs, memberships) {
  const createdAt = new Date(workspace.createdAt).getTime();
  const candidates = logs.filter((log) => {
    if (!log.userId) return false;
    let metadata;
    try {
      metadata = JSON.parse(log.metadata);
    } catch {
      return false;
    }
    if (metadata?.workspaceId != null)
      return metadata.workspaceId === workspace.id;
    // Old creation events had only a name. Corroborate them with the membership
    // inserted at creation; never treat the first invited member as the creator.
    const elapsed = new Date(log.occurredAt).getTime() - createdAt;
    if (elapsed < 0 || elapsed > 30000) return false;
    const originalMember = memberships.some(
      (member) =>
        member.workspace_id === workspace.id &&
        member.user_id === log.userId &&
        new Date(member.createdAt).getTime() >= createdAt &&
        new Date(member.createdAt).getTime() - createdAt < 1000
    );
    return (
      originalMember &&
      (metadata?.workspaceName === workspace.name || elapsed < 1000)
    );
  });
  const ids = [...new Set(candidates.map((log) => log.userId))];
  return ids.length === 1 ? ids[0] : null;
}

async function withWorkspaceListRelation(workspaces, user) {
  if (!user?.id || !workspaces.length) return workspaces;
  const [logs, memberships] = await Promise.all([
    prisma.event_logs.findMany({
      where: { event: "workspace_created" },
      select: { userId: true, metadata: true, occurredAt: true },
    }),
    prisma.workspace_users.findMany({
      where: { workspace_id: { in: workspaces.map((w) => w.id) } },
      select: { workspace_id: true, user_id: true, createdAt: true },
    }),
  ]);
  return workspaces.map((workspace) => ({
    ...workspace,
    viewerRelation:
      creatorFor(workspace, logs, memberships) === user.id
        ? "creator"
        : memberships.some(
              (m) => m.workspace_id === workspace.id && m.user_id === user.id
            )
          ? "member"
          : "other",
  }));
}
module.exports = { creatorFor, withWorkspaceListRelation };
