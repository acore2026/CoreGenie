CREATE TABLE "global_reference_entries" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "payload" TEXT,
  "revision" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "nextRefreshAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3)
);
CREATE INDEX "global_reference_entries_nextRefreshAt_idx" ON "global_reference_entries"("nextRefreshAt");
