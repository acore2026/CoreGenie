const path = require("path");
const prisma = require("../utils/prisma");

// Replaces the three independent 3GPP seed versions. Bump this when changing
// bundled definitions for installations that do not use repository sync.
const SEED_SETTING = "agent_config_seed_v1";
const CONFIG_ROOT = path.resolve(__dirname, "../../agent-config");
const LEGACY_NAMES = {
  "skills/3gpp-review": ["3gpp-tdocs"],
  "agents/3gpp-review": ["3GPP 提案分析助手（Skill）"],
};
let seedPromise = null;

async function seedRepositoryConfig() {
  // Never run a second writer alongside the live synchronizer.
  if (require("../config-sync").enabled()) return;
  const completed = await prisma.system_settings.findUnique({
    where: { label: SEED_SETTING },
  });
  if (completed?.value === "complete") return;

  const { ConfigFiles } = require("../config-sync/files");
  const { ConfigDatabase } = require("../config-sync/database");
  const { parseSkillMarkdown } = require("./package");
  const definitions = await new ConfigFiles(CONFIG_ROOT).list();
  if (!definitions["global-prompt"])
    throw new Error("Bundled global-prompt.md is missing.");
  const keys = Object.keys(definitions).sort(
    (a, b) =>
      Number(!a.startsWith("skills/")) - Number(!b.startsWith("skills/")) ||
      a.localeCompare(b)
  );
  if (
    !keys.some((key) => key.startsWith("agents/")) ||
    !keys.some((key) => key.startsWith("skills/"))
  )
    throw new Error("Bundled Agent or Skill definitions are missing.");
  const names = {};
  const seen = new Set();
  for (const key of keys) {
    const { value, error } = definitions[key];
    if (error)
      throw new Error(`Invalid bundled configuration ${key}: ${error}`);
    if (key === "global-prompt") continue;
    names[key] = key.startsWith("skills/")
      ? parseSkillMarkdown(value.skillMd).manifest.name
      : value.name;
    const identity = `${key.split("/")[0]}:${names[key]}`;
    if (seen.has(identity))
      throw new Error(`Duplicate bundled name: ${identity}`);
    seen.add(identity);
    if (key.startsWith("agents/"))
      for (const skill of value.skills)
        if (!definitions[`skills/${skill}`])
          throw new Error(`Missing bundled Skill ${skill} for ${key}`);
  }

  // Seed definitions and the version marker together. Existing revision files
  // remain available to historical runs; no repository files are written.
  await prisma.$transaction(
    async (client) => {
      if (
        (
          await client.system_settings.findUnique({
            where: { label: SEED_SETTING },
          })
        )?.value === "complete"
      )
        return;
      const records = {
        agents: await client.predefined_agents.findMany(),
        skills: await client.predefined_agent_skills.findMany(),
      };
      const state = { entries: {}, keys: {} };
      const database = new ConfigDatabase(prisma);
      const ids = {};
      const claimed = new Set();
      for (const key of keys) {
        if (key === "global-prompt") continue;
        const kind = key.split("/")[0];
        const candidates = records[kind].filter(
          (record) =>
            record.name === names[key] ||
            (LEGACY_NAMES[key] || []).includes(record.name) ||
            (key === "agents/general-assistant" && record.isBuiltinDefault)
        );
        if (candidates.length > 1)
          throw new Error(`Ambiguous existing configuration: ${key}`);
        ids[key] = candidates[0]?.id;
        if (ids[key]) {
          const identity = `${kind}:${ids[key]}`;
          if (claimed.has(identity))
            throw new Error(
              `Existing record matches multiple definitions: ${key}`
            );
          claimed.add(identity);
        }
      }
      for (const key of keys) {
        // A global prompt may already have been edited before this seed existed.
        if (
          key === "global-prompt" &&
          (await client.system_settings.findUnique({
            where: { label: "global_system_prompt" },
          }))
        )
          continue;
        const id = await database.apply(
          client,
          key,
          definitions[key].value,
          ids[key],
          state
        );
        state.entries[key] = { id };
      }
      await client.system_settings.upsert({
        where: { label: SEED_SETTING },
        create: { label: SEED_SETTING, value: "complete" },
        update: { value: "complete", lastUpdatedAt: new Date() },
      });
    },
    { timeout: 30000 }
  );
}

async function seedBuiltinSkills() {
  if (require("../config-sync").enabled() || process.env.NODE_ENV === "test")
    return;
  if (!seedPromise) {
    seedPromise = seedRepositoryConfig().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

module.exports = {
  seedBuiltinSkills,
  seedRepositoryConfig,
  SEED_SETTING,
  CONFIG_ROOT,
};
