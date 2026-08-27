const { v4 } = require("uuid");
const prisma = require("../utils/prisma");
const CMD_REGEX = new RegExp(/[^a-zA-Z0-9_-]/g);

const SlashCommandPresets = {
  formatCommand: function (command = "") {
    if (!command || command.length < 2) return `/${v4().split("-")[0]}`;

    let adjustedCmd = command.toLowerCase(); // force lowercase
    if (!adjustedCmd.startsWith("/")) adjustedCmd = `/${adjustedCmd}`; // Fix if no preceding / is found.
    return `/${adjustedCmd.slice(1).toLowerCase().replace(CMD_REGEX, "-")}`; // replace any invalid chars with '-'
  },

  get: async function (clause = {}) {
    try {
      const preset = await prisma.slash_command_presets.findFirst({
        where: clause,
      });
      return preset || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit) {
    try {
      const presets = await prisma.slash_command_presets.findMany({
        where: clause,
        take: limit || undefined,
      });
      return presets;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  // Quick commands are installation-wide. The legacy userId argument is kept
  // for call-site compatibility, but all new commands use the global uid (0).
  create: async function (_userId = null, presetData = {}) {
    try {
      const existingPreset = await this.get({
        uid: 0,
        command: String(presetData.command),
      });

      if (existingPreset) {
        console.log(
          "SlashCommandPresets.create - preset already exists - will not create"
        );
        return existingPreset;
      }

      const preset = await prisma.slash_command_presets.create({
        data: {
          ...presetData,
          uid: 0,
          userId: null,
        },
      });
      return preset;
    } catch (error) {
      console.error("Failed to create preset", error.message);
      return null;
    }
  },

  getGlobalPresets: async function () {
    try {
      return (
        await prisma.slash_command_presets.findMany({
          where: { uid: 0 },
          orderBy: { createdAt: "asc" },
        })
      )?.map((preset) => ({
        id: preset.id,
        command: preset.command,
        prompt: preset.prompt,
        description: preset.description,
      }));
    } catch (error) {
      console.error("Failed to get user presets", error.message);
      return [];
    }
  },

  // Compatibility alias for integrations that still use the old method name.
  getUserPresets: async function () {
    return this.getGlobalPresets();
  },

  update: async function (presetId = null, presetData = {}) {
    try {
      const preset = await prisma.slash_command_presets.update({
        where: { id: Number(presetId) },
        data: presetData,
      });
      return preset;
    } catch (error) {
      console.error("Failed to update preset", error.message);
      return null;
    }
  },

  delete: async function (presetId = null) {
    try {
      await prisma.slash_command_presets.delete({
        where: { id: Number(presetId) },
      });
      return true;
    } catch (error) {
      console.error("Failed to delete preset", error.message);
      return false;
    }
  },

  // Commands remain global when multi-user mode is enabled.
  migrateToMultiUser: async function () {
    return;
  },
};

module.exports.SlashCommandPresets = SlashCommandPresets;
