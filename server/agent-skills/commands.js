const fs = require("node:fs/promises");
const path = require("node:path");

const COMMAND_SEED_SETTING = "builtin_commands_seed_v1";
const COMMAND_ROOT = path.resolve(__dirname, "../../agent-config/commands");

async function seedBuiltinCommands(prisma) {
  if (
    (
      await prisma.system_settings.findUnique({
        where: { label: COMMAND_SEED_SETTING },
      })
    )?.value === "complete"
  )
    return;
  const names = (await fs.readdir(COMMAND_ROOT))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (!names.length) throw new Error("Bundled commands are missing.");
  const definitions = [];
  const seen = new Set();
  for (const name of names) {
    const data = JSON.parse(
      await fs.readFile(path.join(COMMAND_ROOT, name), "utf8")
    );
    if (
      !/^\/[a-z0-9][a-z0-9_-]*$/.test(data.command) ||
      typeof data.prompt !== "string" ||
      !data.prompt.trim() ||
      typeof data.description !== "string" ||
      !data.description.trim() ||
      seen.has(data.command)
    )
      throw new Error("Invalid bundled command: " + name);
    seen.add(data.command);
    definitions.push(data);
  }
  await prisma.$transaction(async (client) => {
    for (const { command, prompt, description } of definitions) {
      await client.slash_command_presets.upsert({
        where: { uid_command: { uid: 0, command } },
        create: { uid: 0, userId: null, command, prompt, description },
        // Installation edits always win; this only fills missing presets.
        update: {},
      });
    }
    await client.system_settings.upsert({
      where: { label: COMMAND_SEED_SETTING },
      create: { label: COMMAND_SEED_SETTING, value: "complete" },
      update: { value: "complete" },
    });
  });
}
module.exports = { seedBuiltinCommands, COMMAND_SEED_SETTING };
