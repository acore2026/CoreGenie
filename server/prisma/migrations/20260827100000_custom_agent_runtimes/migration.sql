-- Runtime selection is stored on Agent definitions, while every run keeps an
-- immutable runtime and Agent snapshot for deterministic resume/recovery.
ALTER TABLE "predefined_agents" ADD COLUMN "runtimeKey" TEXT NOT NULL DEFAULT 'default-react';
ALTER TABLE "predefined_agents" ADD COLUMN "runtimeConfig" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "agent_runs" ADD COLUMN "runtimeKey" TEXT NOT NULL DEFAULT 'default-react';
ALTER TABLE "agent_runs" ADD COLUMN "runtimeVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "agent_runs" ADD COLUMN "runtimeSnapshot" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "agent_runs_runtimeKey_runtimeVersion_idx"
ON "agent_runs"("runtimeKey", "runtimeVersion");
