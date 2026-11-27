CREATE TABLE "announcements" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "announcements_startsAt_idx" ON "announcements"("startsAt");
CREATE TABLE "announcement_reads" (
    "id" SERIAL NOT NULL,
    "announcementId" INTEGER NOT NULL,
    "readerKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcement_reads_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "announcement_reads_announcementId_readerKey_key" ON "announcement_reads"("announcementId", "readerKey");
CREATE INDEX "announcement_reads_readerKey_idx" ON "announcement_reads"("readerKey");
