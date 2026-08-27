-- CreateTable
CREATE TABLE "public_chat_shares" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "thread_id" INTEGER,
    "user_id" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "public_chat_shares_token_key" ON "public_chat_shares"("token");

-- CreateIndex
CREATE INDEX "public_chat_shares_workspace_id_thread_id_user_id_idx" ON "public_chat_shares"("workspace_id", "thread_id", "user_id");
