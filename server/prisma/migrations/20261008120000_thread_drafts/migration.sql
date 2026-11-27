ALTER TABLE "workspace_threads" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "workspace_threads" ADD COLUMN "draftTouchedAt" TIMESTAMP(3);
CREATE TABLE "workspace_thread_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "threadId" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workspace_thread_sessions_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "workspace_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "workspace_thread_sessions_threadId_expiresAt_idx" ON "workspace_thread_sessions"("threadId", "expiresAt");
-- Existing submissions keep their visibility even after history was reset.
UPDATE "workspace_threads" SET "submittedAt" = "createdAt"
WHERE EXISTS (SELECT 1 FROM "workspace_chats" WHERE "thread_id" = "workspace_threads"."id")
   OR EXISTS (SELECT 1 FROM "agent_runs" WHERE "thread_id" = "workspace_threads"."id")
   OR EXISTS (SELECT 1 FROM "workspace_agent_invocations" WHERE "thread_id" = "workspace_threads"."id");
