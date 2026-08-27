-- Quick commands are shared installation-wide. Preserve the oldest copy of
-- duplicate commands before assigning every remaining preset to global uid 0.
DELETE FROM "slash_command_presets"
WHERE "id" NOT IN (
  SELECT MIN("id")
  FROM "slash_command_presets"
  GROUP BY "command"
);

UPDATE "slash_command_presets"
SET "userId" = NULL, "uid" = 0;
