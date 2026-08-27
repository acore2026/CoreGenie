-- Add per-user instructions and make memory recall opt-out for new installs.
ALTER TABLE "users" ADD COLUMN "systemPrompt" TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO "system_settings" ("label", "value", "createdAt", "lastUpdatedAt")
VALUES ('memory_enabled', 'true', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
