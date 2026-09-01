CREATE TABLE "agent_feedback_reasons" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "agent_feedback_reasons_code_key"
ON "agent_feedback_reasons"("code");
CREATE INDEX "agent_feedback_reasons_enabled_sortOrder_idx"
ON "agent_feedback_reasons"("enabled", "sortOrder");

INSERT INTO "agent_feedback_reasons" ("code", "label", "sortOrder") VALUES
  ('incorrect', '内容不准确', 10),
  ('incomplete', '没有完整完成要求', 20),
  ('source-issue', '资料或引用有问题', 30),
  ('tool-failure', '工具、下载或文件处理失败', 40),
  ('format-unusable', '格式或文件不好用', 50),
  ('too-slow', '等待时间太长', 60),
  ('other', '其他', 70);

CREATE TABLE "agent_response_feedback" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "chat_id" INTEGER NOT NULL,
  "run_id" TEXT NOT NULL,
  "workspace_id" INTEGER NOT NULL,
  "user_id" INTEGER,
  "agent_id" INTEGER,
  "rating" TEXT NOT NULL,
  "reasons" TEXT NOT NULL DEFAULT '[]',
  "comment" TEXT,
  "source" TEXT NOT NULL DEFAULT 'user',
  "syncStatus" TEXT NOT NULL DEFAULT 'pending',
  "syncAttempts" INTEGER NOT NULL DEFAULT 0,
  "syncError" TEXT,
  "syncedAt" DATETIME,
  "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_response_feedback_chat_id_fkey"
    FOREIGN KEY ("chat_id") REFERENCES "workspace_chats" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_response_feedback_chat_id_key"
ON "agent_response_feedback"("chat_id");
CREATE INDEX "agent_response_feedback_run_id_idx"
ON "agent_response_feedback"("run_id");
CREATE INDEX "agent_response_feedback_workspace_id_agent_id_rating_idx"
ON "agent_response_feedback"("workspace_id", "agent_id", "rating");
CREATE INDEX "agent_response_feedback_syncStatus_lastUpdatedAt_idx"
ON "agent_response_feedback"("syncStatus", "lastUpdatedAt");

INSERT INTO "agent_response_feedback" (
  "id", "chat_id", "run_id", "workspace_id", "user_id", "agent_id",
  "rating", "reasons", "source", "syncStatus", "createdAt", "lastUpdatedAt"
)
SELECT
  'legacy-chat-' || "id",
  "id",
  json_extract("response", '$.agentRunId'),
  "workspaceId",
  "user_id",
  json_extract("response", '$.agentId'),
  CASE WHEN "feedbackScore" = true THEN 'good' ELSE 'bad' END,
  '[]',
  'legacy',
  'pending',
  "lastUpdatedAt",
  "lastUpdatedAt"
FROM "workspace_chats"
WHERE "feedbackScore" IS NOT NULL
  AND json_valid("response") = 1
  AND json_extract("response", '$.agentRunId') IS NOT NULL;
