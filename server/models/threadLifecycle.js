const prisma = require("../utils/prisma");

// Drafts are private even in collaborative workspaces and for administrators.
function threadVisibility(userId) {
  return {
    OR: [
      { submittedAt: { not: null } },
      ...(userId ? [{ user_id: Number(userId) }] : []),
    ],
  };
}

function canViewThread(thread, userId) {
  return Boolean(
    thread &&
    (thread.submittedAt || (userId && thread.user_id === Number(userId)))
  );
}

async function acceptThreadSubmission(threadId) {
  if (!threadId) return;
  const result = await prisma.workspace_threads.updateMany({
    where: { id: Number(threadId) },
    data: { submittedAt: new Date() },
  });
  if (!result.count) throw new Error("会话不存在或已经删除。");
}

async function retainThreadDraft(threadId) {
  if (!threadId) return;
  const result = await prisma.workspace_threads.updateMany({
    where: { id: Number(threadId) },
    data: { draftTouchedAt: new Date() },
  });
  if (!result.count) throw new Error("会话不存在或已经删除。");
}

// Both sessions and cleanup first write the same row. This serializes cleanup
// against draft protection and accepted submissions on SQLite and PostgreSQL.
async function updateDraftSession({
  threadId,
  userId,
  sessionId,
  action,
  retain,
}) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.workspace_threads.updateMany({
      where: { id: threadId, user_id: userId },
      data: {
        lastUpdatedAt: new Date(),
        ...(retain ? { draftTouchedAt: new Date() } : {}),
      },
    });
    if (!claimed.count) return { deleted: false };
    const thread = await tx.workspace_threads.findUnique({
      where: { id: threadId },
    });
    if (!["leave", "release"].includes(action)) {
      await tx.workspace_thread_sessions.upsert({
        where: { id: sessionId },
        create: {
          id: sessionId,
          threadId,
          expiresAt: new Date(Date.now() + 90_000),
        },
        update: { expiresAt: new Date(Date.now() + 90_000) },
      });
      return { deleted: false };
    }
    await tx.workspace_thread_sessions.deleteMany({
      where: { id: sessionId, threadId },
    });
    // Page refresh and close release their lease without deleting the thread.
    if (action === "release") return { deleted: false };
    if (thread.submittedAt || thread.draftTouchedAt || thread.name !== "Thread")
      return { deleted: false };
    const [sessions, chats, runs, files] = await Promise.all([
      tx.workspace_thread_sessions.count({
        where: { threadId, expiresAt: { gt: new Date() } },
      }),
      tx.workspace_chats.count({ where: { thread_id: threadId } }),
      tx.agent_runs.count({ where: { thread_id: threadId } }),
      tx.workspace_parsed_files.count({ where: { threadId } }),
    ]);
    if (sessions || chats || runs || files) return { deleted: false };
    await tx.workspace_threads.delete({ where: { id: threadId } });
    return { deleted: true };
  });
}

module.exports = {
  threadVisibility,
  canViewThread,
  acceptThreadSubmission,
  retainThreadDraft,
  updateDraftSession,
};
