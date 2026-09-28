CREATE TABLE "global_documents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "docId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "docpath" TEXT NOT NULL,
    "metadata" TEXT,
    "createdBy" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "global_documents_docId_key" ON "global_documents"("docId");
CREATE UNIQUE INDEX "global_documents_docpath_key" ON "global_documents"("docpath");
CREATE INDEX "global_documents_createdAt_idx" ON "global_documents"("createdAt");
