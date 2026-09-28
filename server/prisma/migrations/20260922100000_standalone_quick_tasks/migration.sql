CREATE TABLE "predefined_quick_tasks" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "definition" TEXT NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "predefined_quick_tasks_key_key" ON "predefined_quick_tasks"("key");
CREATE INDEX "predefined_quick_tasks_archived_idx" ON "predefined_quick_tasks"("archived");
ALTER TABLE "predefined_agents" ADD COLUMN "quickTaskIds" TEXT NOT NULL DEFAULT '[]';
