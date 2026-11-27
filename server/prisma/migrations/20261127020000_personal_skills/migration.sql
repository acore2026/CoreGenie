CREATE TABLE "personal_agent_skills" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ownerId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "activeRevision" TEXT NOT NULL,
  "isShared" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personal_agent_skills_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personal_agent_skills_ownerId_name_key" ON "personal_agent_skills"("ownerId", "name");
CREATE INDEX "personal_agent_skills_isShared_idx" ON "personal_agent_skills"("isShared");
CREATE TABLE "personal_skill_subscriptions" (
  "userId" INTEGER NOT NULL,
  "skillId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "skillId"),
  CONSTRAINT "personal_skill_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personal_skill_subscriptions_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "personal_agent_skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personal_skill_subscriptions_skillId_idx" ON "personal_skill_subscriptions"("skillId");
