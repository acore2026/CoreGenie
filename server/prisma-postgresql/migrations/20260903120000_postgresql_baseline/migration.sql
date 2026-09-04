-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "secret" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_documents" (
    "id" SERIAL NOT NULL,
    "docId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "docpath" TEXT NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "metadata" TEXT,
    "pinned" BOOLEAN DEFAULT false,
    "watched" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedBy" INTEGER,
    "workspaceIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT,
    "password" TEXT NOT NULL,
    "pfpFilename" TEXT,
    "role" TEXT NOT NULL DEFAULT 'default',
    "suspended" INTEGER NOT NULL DEFAULT 0,
    "seen_recovery_codes" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dailyMessageLimit" INTEGER,
    "bio" TEXT DEFAULT '',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "web_push_subscription_config" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code_hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_vectors" (
    "id" SERIAL NOT NULL,
    "docId" TEXT NOT NULL,
    "vectorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "vectorTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openAiTemp" DOUBLE PRECISION,
    "openAiHistory" INTEGER NOT NULL DEFAULT 20,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openAiPrompt" TEXT,
    "similarityThreshold" DOUBLE PRECISION DEFAULT 0.25,
    "chatProvider" TEXT,
    "chatModel" TEXT,
    "topN" INTEGER DEFAULT 4,
    "chatMode" TEXT DEFAULT 'chat',
    "pfpFilename" TEXT,
    "agentProvider" TEXT,
    "agentModel" TEXT,
    "queryRefusalResponse" TEXT,
    "vectorSearchMode" TEXT DEFAULT 'default',
    "router_id" INTEGER,
    "accessMode" TEXT NOT NULL DEFAULT 'private',

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_threads" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_suggested_messages" (
    "id" SERIAL NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_suggested_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_chats" (
    "id" SERIAL NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "include" BOOLEAN NOT NULL DEFAULT true,
    "user_id" INTEGER,
    "thread_id" INTEGER,
    "api_session_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedbackScore" BOOLEAN,
    "memory_processed" BOOLEAN,

    CONSTRAINT "workspace_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_feedback_reasons" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_feedback_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_response_feedback" (
    "id" TEXT NOT NULL,
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
    "syncedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_response_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_chat_shares" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "thread_id" INTEGER,
    "user_id" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_chat_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_agent_invocations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "user_id" INTEGER,
    "thread_id" INTEGER,
    "agent_id" INTEGER,
    "workspace_id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_agent_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "thread_id" INTEGER,
    "user_id" INTEGER,
    "agent_id" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'workspace',
    "mode" TEXT NOT NULL DEFAULT 'automatic',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "prompt" TEXT NOT NULL,
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "configuration" TEXT NOT NULL DEFAULT '{}',
    "runtimeKey" TEXT NOT NULL DEFAULT 'governed-agent',
    "runtimeVersion" INTEGER NOT NULL DEFAULT 1,
    "runtimeSnapshot" TEXT NOT NULL DEFAULT '{}',
    "checkpointThreadId" TEXT NOT NULL,
    "parent_run_id" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "terminationReason" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "nextEventSequence" INTEGER NOT NULL DEFAULT 0,
    "policySnapshot" TEXT NOT NULL DEFAULT '{}',
    "finalResponse" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_events" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_executions" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "task_id" TEXT,
    "tool_id" TEXT NOT NULL,
    "agent_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "operation_key" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "outcome_code" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "result_summary" TEXT,
    "artifact_ids" TEXT NOT NULL DEFAULT '[]',
    "arguments" TEXT NOT NULL DEFAULT '{}',
    "result" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_tasks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "parent_task_id" TEXT,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "agent_id" INTEGER,
    "dependsOn" TEXT NOT NULL DEFAULT '[]',
    "allowedToolIds" TEXT NOT NULL DEFAULT '[]',
    "requiredCapabilities" TEXT NOT NULL DEFAULT '[]',
    "successCriteria" TEXT NOT NULL DEFAULT '[]',
    "acceptsPartialDependencies" BOOLEAN NOT NULL DEFAULT false,
    "writeIntent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "progress" TEXT,
    "resultSummary" TEXT,
    "error" TEXT,
    "budget" TEXT NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_evidence" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "task_id" TEXT,
    "tool_execution_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "uri" TEXT,
    "excerpt" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "usedInFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_artifacts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "task_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mimeType" TEXT,
    "storagePath" TEXT,
    "content" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_commands" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "task_id" TEXT,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_run_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_report_publications" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "documentId" INTEGER,
    "documentPath" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'publishing',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_report_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_capabilities" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vision" BOOLEAN NOT NULL DEFAULT false,
    "toolCalling" BOOLEAN NOT NULL DEFAULT false,
    "structuredOutput" BOOLEAN NOT NULL DEFAULT false,
    "reasoningControls" BOOLEAN NOT NULL DEFAULT false,
    "contextWindow" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predefined_agent_skills" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL,
    "activeRevision" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predefined_agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skill_revisions" (
    "id" TEXT NOT NULL,
    "skillId" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "manifest" TEXT NOT NULL,
    "fileManifest" TEXT NOT NULL DEFAULT '[]',
    "packagePath" TEXT NOT NULL,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_skill_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predefined_agents" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "iconFilename" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "welcomeMessage" TEXT,
    "examplePrompts" TEXT NOT NULL DEFAULT '[]',
    "tools" TEXT,
    "skillIds" TEXT NOT NULL DEFAULT '[]',
    "systemPrompt" TEXT NOT NULL,
    "runtimeKey" TEXT NOT NULL DEFAULT 'governed-agent',
    "runtimeConfig" TEXT NOT NULL DEFAULT '{}',
    "isBuiltinDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predefined_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_users" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_data" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "belongsTo" TEXT,
    "byId" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cache_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embed_configs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "chat_mode" TEXT NOT NULL DEFAULT 'query',
    "allowlist_domains" TEXT,
    "allow_model_override" BOOLEAN NOT NULL DEFAULT false,
    "allow_temperature_override" BOOLEAN NOT NULL DEFAULT false,
    "allow_prompt_override" BOOLEAN NOT NULL DEFAULT false,
    "max_chats_per_day" INTEGER,
    "max_chats_per_session" INTEGER,
    "message_limit" INTEGER DEFAULT 20,
    "workspace_id" INTEGER NOT NULL,
    "createdBy" INTEGER,
    "usersId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embed_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embed_chats" (
    "id" SERIAL NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "include" BOOLEAN NOT NULL DEFAULT true,
    "connection_information" TEXT,
    "embed_id" INTEGER NOT NULL,
    "usersId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embed_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "metadata" TEXT,
    "userId" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slash_command_presets" (
    "id" SERIAL NOT NULL,
    "command" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "uid" INTEGER NOT NULL DEFAULT 0,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slash_command_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sync_queues" (
    "id" SERIAL NOT NULL,
    "staleAfterMs" INTEGER NOT NULL DEFAULT 604800000,
    "nextSyncAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceDocId" INTEGER NOT NULL,

    CONSTRAINT "document_sync_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sync_executions" (
    "id" SERIAL NOT NULL,
    "queueId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sync_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_extension_api_keys" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_extension_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_auth_tokens" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temporary_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_prompt_variables" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'system',
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_prompt_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_history" (
    "id" SERIAL NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "modifiedBy" INTEGER,
    "modifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desktop_mobile_devices" (
    "id" SERIAL NOT NULL,
    "deviceOs" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desktop_mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_parsed_files" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "userId" INTEGER,
    "threadId" INTEGER,
    "metadata" TEXT,
    "tokenCountEstimate" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_parsed_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_communication_connectors" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_communication_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "workspace_id" INTEGER,
    "agent_id" INTEGER,
    "tools" TEXT,
    "schedule" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'recurring',
    "scheduleConfig" TEXT NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_by" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_job_runs" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "workspace_id" INTEGER,
    "scope" TEXT NOT NULL DEFAULT 'workspace',
    "content" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_routers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fallback_provider" TEXT NOT NULL,
    "fallback_model" TEXT NOT NULL,
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 30,
    "created_by" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_routers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_router_rules" (
    "id" SERIAL NOT NULL,
    "router_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'calculated',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "condition_logic" TEXT,
    "conditions" TEXT,
    "route_provider" TEXT NOT NULL,
    "route_model" TEXT NOT NULL,
    "created_by" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_router_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_secret_key" ON "api_keys"("secret");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_documents_docId_key" ON "workspace_documents"("docId");

-- CreateIndex
CREATE UNIQUE INDEX "invites_code_key" ON "invites"("code");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_label_key" ON "system_settings"("label");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_threads_slug_key" ON "workspace_threads"("slug");

-- CreateIndex
CREATE INDEX "workspace_threads_workspace_id_idx" ON "workspace_threads"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_threads_user_id_idx" ON "workspace_threads"("user_id");

-- CreateIndex
CREATE INDEX "workspace_suggested_messages_workspaceId_idx" ON "workspace_suggested_messages"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_feedback_reasons_code_key" ON "agent_feedback_reasons"("code");

-- CreateIndex
CREATE INDEX "agent_feedback_reasons_enabled_sortOrder_idx" ON "agent_feedback_reasons"("enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "agent_response_feedback_chat_id_key" ON "agent_response_feedback"("chat_id");

-- CreateIndex
CREATE INDEX "agent_response_feedback_run_id_idx" ON "agent_response_feedback"("run_id");

-- CreateIndex
CREATE INDEX "agent_response_feedback_workspace_id_agent_id_rating_idx" ON "agent_response_feedback"("workspace_id", "agent_id", "rating");

-- CreateIndex
CREATE INDEX "agent_response_feedback_syncStatus_lastUpdatedAt_idx" ON "agent_response_feedback"("syncStatus", "lastUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "public_chat_shares_token_key" ON "public_chat_shares"("token");

-- CreateIndex
CREATE INDEX "public_chat_shares_workspace_id_thread_id_user_id_idx" ON "public_chat_shares"("workspace_id", "thread_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_agent_invocations_uuid_key" ON "workspace_agent_invocations"("uuid");

-- CreateIndex
CREATE INDEX "workspace_agent_invocations_uuid_idx" ON "workspace_agent_invocations"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_checkpointThreadId_key" ON "agent_runs"("checkpointThreadId");

-- CreateIndex
CREATE INDEX "agent_runs_workspace_id_thread_id_user_id_status_idx" ON "agent_runs"("workspace_id", "thread_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "agent_runs_createdAt_idx" ON "agent_runs"("createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_runtimeKey_runtimeVersion_idx" ON "agent_runs"("runtimeKey", "runtimeVersion");

-- CreateIndex
CREATE INDEX "agent_runs_status_leaseExpiresAt_idx" ON "agent_runs"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "agent_runs_parent_run_id_idx" ON "agent_runs"("parent_run_id");

-- CreateIndex
CREATE INDEX "agent_run_events_run_id_createdAt_idx" ON "agent_run_events"("run_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_events_run_id_sequence_key" ON "agent_run_events"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "agent_tool_executions_run_id_status_idx" ON "agent_tool_executions"("run_id", "status");

-- CreateIndex
CREATE INDEX "agent_tool_executions_run_id_task_id_idx" ON "agent_tool_executions"("run_id", "task_id");

-- CreateIndex
CREATE INDEX "agent_tool_executions_run_id_operation_key_idx" ON "agent_tool_executions"("run_id", "operation_key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tool_executions_run_id_call_id_key" ON "agent_tool_executions"("run_id", "call_id");

-- CreateIndex
CREATE INDEX "agent_run_tasks_run_id_status_idx" ON "agent_run_tasks"("run_id", "status");

-- CreateIndex
CREATE INDEX "agent_run_tasks_run_id_parent_task_id_idx" ON "agent_run_tasks"("run_id", "parent_task_id");

-- CreateIndex
CREATE INDEX "agent_run_evidence_run_id_task_id_idx" ON "agent_run_evidence"("run_id", "task_id");

-- CreateIndex
CREATE INDEX "agent_run_evidence_run_id_usedInFinal_idx" ON "agent_run_evidence"("run_id", "usedInFinal");

-- CreateIndex
CREATE INDEX "agent_run_artifacts_run_id_task_id_idx" ON "agent_run_artifacts"("run_id", "task_id");

-- CreateIndex
CREATE INDEX "agent_run_commands_run_id_status_idx" ON "agent_run_commands"("run_id", "status");

-- CreateIndex
CREATE INDEX "agent_report_publications_workspace_id_createdAt_idx" ON "agent_report_publications"("workspace_id", "createdAt");

-- CreateIndex
CREATE INDEX "agent_report_publications_run_id_status_idx" ON "agent_report_publications"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_report_publications_run_id_sourcePath_key" ON "agent_report_publications"("run_id", "sourcePath");

-- CreateIndex
CREATE INDEX "model_capabilities_provider_idx" ON "model_capabilities"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "model_capabilities_provider_model_key" ON "model_capabilities"("provider", "model");

-- CreateIndex
CREATE INDEX "predefined_agent_skills_name_idx" ON "predefined_agent_skills"("name");

-- CreateIndex
CREATE INDEX "predefined_agent_skills_archived_idx" ON "predefined_agent_skills"("archived");

-- CreateIndex
CREATE INDEX "agent_skill_revisions_skillId_createdAt_idx" ON "agent_skill_revisions"("skillId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_skill_revisions_skillId_sha256_key" ON "agent_skill_revisions"("skillId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "embed_configs_uuid_key" ON "embed_configs"("uuid");

-- CreateIndex
CREATE INDEX "event_logs_event_idx" ON "event_logs"("event");

-- CreateIndex
CREATE UNIQUE INDEX "slash_command_presets_uid_command_key" ON "slash_command_presets"("uid", "command");

-- CreateIndex
CREATE UNIQUE INDEX "document_sync_queues_workspaceDocId_key" ON "document_sync_queues"("workspaceDocId");

-- CreateIndex
CREATE UNIQUE INDEX "browser_extension_api_keys_key_key" ON "browser_extension_api_keys"("key");

-- CreateIndex
CREATE INDEX "browser_extension_api_keys_user_id_idx" ON "browser_extension_api_keys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "temporary_auth_tokens_token_key" ON "temporary_auth_tokens"("token");

-- CreateIndex
CREATE INDEX "temporary_auth_tokens_token_idx" ON "temporary_auth_tokens"("token");

-- CreateIndex
CREATE INDEX "temporary_auth_tokens_userId_idx" ON "temporary_auth_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "system_prompt_variables_key_key" ON "system_prompt_variables"("key");

-- CreateIndex
CREATE INDEX "system_prompt_variables_userId_idx" ON "system_prompt_variables"("userId");

-- CreateIndex
CREATE INDEX "prompt_history_workspaceId_idx" ON "prompt_history"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "desktop_mobile_devices_token_key" ON "desktop_mobile_devices"("token");

-- CreateIndex
CREATE INDEX "desktop_mobile_devices_userId_idx" ON "desktop_mobile_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_parsed_files_filename_key" ON "workspace_parsed_files"("filename");

-- CreateIndex
CREATE INDEX "workspace_parsed_files_workspaceId_idx" ON "workspace_parsed_files"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_parsed_files_userId_idx" ON "workspace_parsed_files"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "external_communication_connectors_type_key" ON "external_communication_connectors"("type");

-- CreateIndex
CREATE INDEX "scheduled_jobs_workspace_id_idx" ON "scheduled_jobs"("workspace_id");

-- CreateIndex
CREATE INDEX "scheduled_jobs_created_by_idx" ON "scheduled_jobs"("created_by");

-- CreateIndex
CREATE INDEX "scheduled_job_runs_jobId_idx" ON "scheduled_job_runs"("jobId");

-- CreateIndex
CREATE INDEX "memories_user_id_workspace_id_idx" ON "memories"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "memories_user_id_scope_idx" ON "memories"("user_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "model_routers_name_key" ON "model_routers"("name");

-- CreateIndex
CREATE INDEX "model_router_rules_router_id_idx" ON "model_router_rules"("router_id");

-- CreateIndex
CREATE INDEX "model_router_rules_router_id_enabled_priority_idx" ON "model_router_rules"("router_id", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "model_router_rules_router_id_title_key" ON "model_router_rules"("router_id", "title");

-- AddForeignKey
ALTER TABLE "workspace_documents" ADD CONSTRAINT "workspace_documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_threads" ADD CONSTRAINT "workspace_threads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_threads" ADD CONSTRAINT "workspace_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_suggested_messages" ADD CONSTRAINT "workspace_suggested_messages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_chats" ADD CONSTRAINT "workspace_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_response_feedback" ADD CONSTRAINT "agent_response_feedback_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "workspace_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_agent_invocations" ADD CONSTRAINT "workspace_agent_invocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_agent_invocations" ADD CONSTRAINT "workspace_agent_invocations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_executions" ADD CONSTRAINT "agent_tool_executions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_tasks" ADD CONSTRAINT "agent_run_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_evidence" ADD CONSTRAINT "agent_run_evidence_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_artifacts" ADD CONSTRAINT "agent_run_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_commands" ADD CONSTRAINT "agent_run_commands_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embed_configs" ADD CONSTRAINT "embed_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embed_configs" ADD CONSTRAINT "embed_configs_usersId_fkey" FOREIGN KEY ("usersId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embed_chats" ADD CONSTRAINT "embed_chats_embed_id_fkey" FOREIGN KEY ("embed_id") REFERENCES "embed_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embed_chats" ADD CONSTRAINT "embed_chats_usersId_fkey" FOREIGN KEY ("usersId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slash_command_presets" ADD CONSTRAINT "slash_command_presets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sync_queues" ADD CONSTRAINT "document_sync_queues_workspaceDocId_fkey" FOREIGN KEY ("workspaceDocId") REFERENCES "workspace_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sync_executions" ADD CONSTRAINT "document_sync_executions_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "document_sync_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_extension_api_keys" ADD CONSTRAINT "browser_extension_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_auth_tokens" ADD CONSTRAINT "temporary_auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_prompt_variables" ADD CONSTRAINT "system_prompt_variables_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_history" ADD CONSTRAINT "prompt_history_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_history" ADD CONSTRAINT "prompt_history_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desktop_mobile_devices" ADD CONSTRAINT "desktop_mobile_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_parsed_files" ADD CONSTRAINT "workspace_parsed_files_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_parsed_files" ADD CONSTRAINT "workspace_parsed_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_parsed_files" ADD CONSTRAINT "workspace_parsed_files_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "workspace_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_job_runs" ADD CONSTRAINT "scheduled_job_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "scheduled_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_router_rules" ADD CONSTRAINT "model_router_rules_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "model_routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
