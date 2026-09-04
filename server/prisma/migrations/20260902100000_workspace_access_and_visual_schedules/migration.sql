ALTER TABLE "workspaces" ADD COLUMN "accessMode" TEXT NOT NULL DEFAULT 'private';

ALTER TABLE "scheduled_jobs" ADD COLUMN "scheduleType" TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE "scheduled_jobs" ADD COLUMN "scheduleConfig" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "scheduled_jobs" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "scheduled_jobs" ADD COLUMN "created_by" INTEGER;

CREATE INDEX "scheduled_jobs_created_by_idx" ON "scheduled_jobs"("created_by");
