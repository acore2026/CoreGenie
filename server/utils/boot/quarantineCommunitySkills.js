const fs = require("fs");
const path = require("path");

function quarantineCommunitySkills() {
  const storage =
    process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage");
  const source = path.join(storage, "plugins", "agent-skills");
  if (!fs.existsSync(source)) return null;
  const entries = fs.readdirSync(source);
  if (entries.length === 0) return null;

  const quarantineRoot = path.join(storage, "quarantine");
  fs.mkdirSync(quarantineRoot, { recursive: true });
  const destination = path.join(
    quarantineRoot,
    `community-agent-skills-${new Date().toISOString().replace(/[:.]/g, "-")}`
  );
  fs.renameSync(source, destination);
  console.warn(
    `[Security] Quarantined executable Community Agent skills at ${destination}. They will not be loaded.`
  );
  return destination;
}

module.exports = quarantineCommunitySkills;
