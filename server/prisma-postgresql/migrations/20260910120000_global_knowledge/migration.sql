CREATE TABLE "global_documents" (
    "id" SERIAL NOT NULL,
    "docId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "docpath" TEXT NOT NULL,
    "metadata" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "global_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_documents_docId_key" ON "global_documents"("docId");
CREATE UNIQUE INDEX "global_documents_docpath_key" ON "global_documents"("docpath");
CREATE INDEX "global_documents_createdAt_idx" ON "global_documents"("createdAt");
