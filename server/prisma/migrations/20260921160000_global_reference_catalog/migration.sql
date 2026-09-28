CREATE TABLE "global_reference_entries" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "payload" TEXT,
  "revision" TEXT,
  "lastSuccessAt" DATETIME,
  "lastAttemptAt" DATETIME,
  "nextRefreshAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" DATETIME
);
CREATE INDEX "global_reference_entries_nextRefreshAt_idx" ON "global_reference_entries"("nextRefreshAt");
