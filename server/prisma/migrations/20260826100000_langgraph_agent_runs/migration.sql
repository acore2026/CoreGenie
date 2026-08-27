CREATE TABLE "agent_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "thread_id" INTEGER,
  "user_id" INTEGER,
  "agent_id" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'workspace',
  "mode" TEXT NOT NULL DEFAULT 'automatic',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "prompt" TEXT NOT NULL,
  "attachments" TEXT NOT NULL DEFAULT '[]',
  "configuration" TEXT NOT NULL DEFAULT '{}',
  "checkpointThreadId" TEXT NOT NULL,
  "finalResponse" TEXT,
  "error" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "agent_runs_checkpointThreadId_key" ON "agent_runs"("checkpointThreadId");
CREATE INDEX "agent_runs_workspace_id_thread_id_user_id_status_idx" ON "agent_runs"("workspace_id", "thread_id", "user_id", "status");
CREATE INDEX "agent_runs_createdAt_idx" ON "agent_runs"("createdAt");

CREATE TABLE "agent_run_events" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "run_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "type" TEXT NOT NULL,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_run_events_run_id_sequence_key" ON "agent_run_events"("run_id", "sequence");
CREATE INDEX "agent_run_events_run_id_createdAt_idx" ON "agent_run_events"("run_id", "createdAt");

CREATE TABLE "agent_tool_executions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "call_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "tool_id" TEXT NOT NULL,
  "agent_id" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "arguments" TEXT NOT NULL DEFAULT '{}',
  "result" TEXT,
  "error" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_tool_executions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_tool_executions_run_id_call_id_key" ON "agent_tool_executions"("run_id", "call_id");
CREATE INDEX "agent_tool_executions_run_id_status_idx" ON "agent_tool_executions"("run_id", "status");
