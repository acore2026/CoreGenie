CREATE TABLE "agent_report_publications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "documentId" INTEGER,
    "documentPath" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'publishing',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "agent_report_publications_run_id_sourcePath_key"
ON "agent_report_publications"("run_id", "sourcePath");

CREATE INDEX "agent_report_publications_workspace_id_createdAt_idx"
ON "agent_report_publications"("workspace_id", "createdAt");

CREATE INDEX "agent_report_publications_run_id_status_idx"
ON "agent_report_publications"("run_id", "status");
