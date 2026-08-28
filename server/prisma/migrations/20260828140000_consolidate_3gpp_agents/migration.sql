-- Retire the legacy prompt-only 3GPP Agent now that the packaged Skill Agent
-- owns the proposal-analysis workflow.
DELETE FROM "predefined_agents"
WHERE "name" = '3GPP 提案助手'
  AND "isBuiltinDefault" = false;

-- Give the built-in fallback Agent a user-facing Chinese name.
UPDATE "predefined_agents"
SET
    "name" = '通用助手',
    "lastUpdatedAt" = CURRENT_TIMESTAMP
WHERE "isBuiltinDefault" = true;
