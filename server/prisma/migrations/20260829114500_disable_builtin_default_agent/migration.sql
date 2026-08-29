-- The built-in general-purpose Agent remains available for installations that
-- want it, but it no longer has to stay enabled.
UPDATE "predefined_agents"
SET
    "enabled" = false,
    "lastUpdatedAt" = CURRENT_TIMESTAMP
WHERE "isBuiltinDefault" = true;
