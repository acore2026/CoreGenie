ALTER TABLE "predefined_agent_skills" ADD COLUMN "activeRevision" TEXT;
ALTER TABLE "predefined_agent_skills" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "predefined_agent_skills_name_idx" ON "predefined_agent_skills"("name");
CREATE INDEX "predefined_agent_skills_archived_idx" ON "predefined_agent_skills"("archived");

CREATE TABLE "agent_skill_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "manifest" TEXT NOT NULL,
    "fileManifest" TEXT NOT NULL DEFAULT '[]',
    "packagePath" TEXT NOT NULL,
    "createdBy" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "agent_skill_revisions_skillId_sha256_key"
ON "agent_skill_revisions"("skillId", "sha256");
CREATE INDEX "agent_skill_revisions_skillId_createdAt_idx"
ON "agent_skill_revisions"("skillId", "createdAt");
