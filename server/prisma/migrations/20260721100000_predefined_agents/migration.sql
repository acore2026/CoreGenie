-- AlterTable
ALTER TABLE "workspace_agent_invocations" ADD COLUMN "agent_id" INTEGER;

-- CreateTable
CREATE TABLE "predefined_agent_skills" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "predefined_agents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "iconFilename" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "welcomeMessage" TEXT,
    "tools" TEXT,
    "skillIds" TEXT NOT NULL DEFAULT '[]',
    "systemPrompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
