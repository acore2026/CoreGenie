ALTER TABLE "users" ADD COLUMN "displayName" TEXT;
ALTER TABLE "users" ADD COLUMN "employeeNumber" TEXT;
ALTER TABLE "users" ADD COLUMN "oauthSubject" TEXT;
CREATE UNIQUE INDEX "users_oauthSubject_key" ON "users"("oauthSubject");
CREATE TABLE "oauth_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oauth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "oauth_sessions_userId_idx" ON "oauth_sessions"("userId");
CREATE INDEX "oauth_sessions_expiresAt_idx" ON "oauth_sessions"("expiresAt");
