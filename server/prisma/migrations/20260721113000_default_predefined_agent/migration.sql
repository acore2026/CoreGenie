-- Create the installation-wide Default Agent. Its prompt is edited through the
-- same Agent editor as every other predefined Agent.
ALTER TABLE "predefined_agents" ADD COLUMN "isBuiltinDefault" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "predefined_agents" (
    "name",
    "description",
    "welcomeMessage",
    "tools",
    "skillIds",
    "systemPrompt",
    "isBuiltinDefault",
    "enabled",
    "createdAt",
    "lastUpdatedAt"
)
SELECT
    'Default Agent',
    'The installation-wide fallback Agent with access to all enabled Agent Tools.',
    NULL,
    NULL,
    '[]',
    'You are a helpful AI assistant. Follow the user''s instructions carefully, use available tools when useful, and provide clear, accurate answers.',
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "predefined_agents" WHERE "isBuiltinDefault" = true
);

-- Make the built-in Default Agent the installation-wide default.
INSERT INTO "system_settings" ("label", "value", "createdAt", "lastUpdatedAt")
SELECT
    'default_predefined_agent_id',
    CAST("id" AS TEXT),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "predefined_agents"
WHERE "isBuiltinDefault" = true
ORDER BY "id" ASC
LIMIT 1
ON CONFLICT("label") DO UPDATE SET
    "value" = excluded."value",
    "lastUpdatedAt" = CURRENT_TIMESTAMP;

-- Retire both legacy prompt mechanisms. Prompt ownership now belongs solely
-- to predefined Agents.
DELETE FROM "system_settings" WHERE "label" = 'default_system_prompt';
UPDATE "workspaces" SET "openAiPrompt" = NULL;
