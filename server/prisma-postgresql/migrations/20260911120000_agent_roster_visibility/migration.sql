-- Agent runtime availability and user-facing roster visibility are independent.
ALTER TABLE "predefined_agents" ADD COLUMN "showInRoster" BOOLEAN NOT NULL DEFAULT true;
