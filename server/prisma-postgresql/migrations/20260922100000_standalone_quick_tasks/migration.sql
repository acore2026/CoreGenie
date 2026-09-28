CREATE TABLE "predefined_quick_tasks" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "definition" TEXT NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "predefined_quick_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "predefined_quick_tasks_key_key" ON "predefined_quick_tasks"("key");
CREATE INDEX "predefined_quick_tasks_archived_idx" ON "predefined_quick_tasks"("archived");
ALTER TABLE "predefined_agents" ADD COLUMN "quickTaskIds" TEXT NOT NULL DEFAULT '[]';
