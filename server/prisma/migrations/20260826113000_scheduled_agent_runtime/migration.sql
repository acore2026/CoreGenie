ALTER TABLE "scheduled_jobs" ADD COLUMN "workspace_id" INTEGER;
ALTER TABLE "scheduled_jobs" ADD COLUMN "agent_id" INTEGER;

CREATE INDEX "scheduled_jobs_workspace_id_idx"
ON "scheduled_jobs"("workspace_id");
