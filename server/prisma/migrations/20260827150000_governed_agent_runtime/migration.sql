ALTER TABLE "agent_runs" ADD COLUMN "parent_run_id" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "agent_runs" ADD COLUMN "terminationReason" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "leaseExpiresAt" DATETIME;
ALTER TABLE "agent_runs" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "agent_runs" ADD COLUMN "nextEventSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN "policySnapshot" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "agent_tool_executions" ADD COLUMN "task_id" TEXT;
ALTER TABLE "agent_tool_executions" ADD COLUMN "operation_key" TEXT;
ALTER TABLE "agent_tool_executions" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "agent_tool_executions" ADD COLUMN "outcome_code" TEXT;
ALTER TABLE "agent_tool_executions" ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agent_tool_executions" ADD COLUMN "result_summary" TEXT;
ALTER TABLE "agent_tool_executions" ADD COLUMN "artifact_ids" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "agent_run_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "parent_task_id" TEXT,
  "title" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "agent_id" INTEGER,
  "dependsOn" TEXT NOT NULL DEFAULT '[]',
  "allowedToolIds" TEXT NOT NULL DEFAULT '[]',
  "requiredCapabilities" TEXT NOT NULL DEFAULT '[]',
  "successCriteria" TEXT NOT NULL DEFAULT '[]',
  "acceptsPartialDependencies" BOOLEAN NOT NULL DEFAULT false,
  "writeIntent" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "maxAttempts" INTEGER NOT NULL DEFAULT 2,
  "progress" TEXT,
  "resultSummary" TEXT,
  "error" TEXT,
  "budget" TEXT NOT NULL DEFAULT '{}',
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "agent_run_evidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "task_id" TEXT,
  "tool_execution_id" TEXT,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "uri" TEXT,
  "excerpt" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "usedInFinal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_evidence_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "agent_run_artifacts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "task_id" TEXT,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "mimeType" TEXT,
  "storagePath" TEXT,
  "content" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "byteSize" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "agent_run_commands" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "task_id" TEXT,
  "type" TEXT NOT NULL,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "result" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  CONSTRAINT "agent_run_commands_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "model_capabilities" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "vision" BOOLEAN NOT NULL DEFAULT false,
  "toolCalling" BOOLEAN NOT NULL DEFAULT false,
  "structuredOutput" BOOLEAN NOT NULL DEFAULT false,
  "reasoningControls" BOOLEAN NOT NULL DEFAULT false,
  "contextWindow" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'admin',
  "updatedBy" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "agent_runs_status_leaseExpiresAt_idx" ON "agent_runs"("status", "leaseExpiresAt");
CREATE INDEX "agent_runs_parent_run_id_idx" ON "agent_runs"("parent_run_id");
CREATE INDEX "agent_tool_executions_run_id_task_id_idx" ON "agent_tool_executions"("run_id", "task_id");
CREATE INDEX "agent_tool_executions_run_id_operation_key_idx" ON "agent_tool_executions"("run_id", "operation_key");
CREATE INDEX "agent_run_tasks_run_id_status_idx" ON "agent_run_tasks"("run_id", "status");
CREATE INDEX "agent_run_tasks_run_id_parent_task_id_idx" ON "agent_run_tasks"("run_id", "parent_task_id");
CREATE INDEX "agent_run_evidence_run_id_task_id_idx" ON "agent_run_evidence"("run_id", "task_id");
CREATE INDEX "agent_run_evidence_run_id_usedInFinal_idx" ON "agent_run_evidence"("run_id", "usedInFinal");
CREATE INDEX "agent_run_artifacts_run_id_task_id_idx" ON "agent_run_artifacts"("run_id", "task_id");
CREATE INDEX "agent_run_commands_run_id_status_idx" ON "agent_run_commands"("run_id", "status");
CREATE UNIQUE INDEX "model_capabilities_provider_model_key" ON "model_capabilities"("provider", "model");
CREATE INDEX "model_capabilities_provider_idx" ON "model_capabilities"("provider");

UPDATE "predefined_agents" SET "runtimeKey" = 'governed-agent';
UPDATE "predefined_agents"
SET "tools" = (
  SELECT json_group_array(value)
  FROM json_each("predefined_agents"."tools")
  WHERE value NOT LIKE '@@flow_%'
)
WHERE "tools" IS NOT NULL AND json_valid("tools");
UPDATE "scheduled_jobs"
SET "tools" = (
  SELECT json_group_array(value)
  FROM json_each("scheduled_jobs"."tools")
  WHERE value NOT LIKE '@@flow_%'
)
WHERE "tools" IS NOT NULL AND json_valid("tools");
