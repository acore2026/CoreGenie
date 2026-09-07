const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const { Synchronizer, hash } = require("./engine");
const { ConfigFiles, validKey } = require("./files");
const { ConfigDatabase } = require("./database");

const context = new AsyncLocalStorage();
let instance = null;
let timer = null;
const enabled = () => process.env.AGENT_CONFIG_SYNC_ENABLED === "true";

function getSynchronizer() {
  if (!enabled()) return null;
  if (instance) return instance;
  const directory = process.env.AGENT_CONFIG_SYNC_DIR;
  if (!directory || !path.isAbsolute(directory))
    throw new Error("请配置绝对路径 AGENT_CONFIG_SYNC_DIR。");
  const prisma = require("../utils/prisma");
  const root = path.resolve(directory);
  const label = `agent_config_sync_${hash(root)}`;
  const saveState = async (state, client = prisma) => {
    const value = JSON.stringify(state);
    await client.system_settings.upsert({
      where: { label },
      create: { label, value },
      update: { value },
    });
  };
  instance = new Synchronizer({
    files: new ConfigFiles(root),
    database: new ConfigDatabase(prisma, saveState),
    loadState: async () => {
      const record = await prisma.system_settings.findUnique({
        where: { label },
      });
      return record ? JSON.parse(record.value) : { entries: {}, keys: {} };
    },
    saveState,
  });
  return instance;
}

async function reconcile(resolution = null) {
  const sync = getSynchronizer();
  if (!sync) return status();
  await context.run(true, () => sync.reconcile(resolution));
  return status();
}

function status() {
  try {
    const sync = getSynchronizer();
    return {
      enabled: enabled(),
      directory: process.env.AGENT_CONFIG_SYNC_DIR || null,
      ...(sync?.status() || { items: [] }),
    };
  } catch (error) {
    return { enabled: enabled(), items: [], error: error.message };
  }
}

// Wrap only shared configuration writes. Nested saves/imports reuse the same lock.
function synchronizeWrites(model, methods, relevant = () => true) {
  for (const method of methods) {
    const original = model[method];
    model[method] = async function (...args) {
      if (!enabled() || context.getStore() || !relevant(...args))
        return original.apply(this, args);
      const sync = getSynchronizer();
      return sync.exclusive(() =>
        context.run(true, async () => {
          const result = await original.apply(this, args);
          try {
            await sync.scan();
          } catch (error) {
            sync.error = error.message;
          }
          return result;
        })
      );
    };
  }
}

async function detail(key) {
  validKey(key);
  const sync = getSynchronizer();
  if (!sync) throw new Error("尚未启用配置同步。");
  return sync.exclusive(() =>
    context.run(true, async () => {
      if (!sync.state) sync.state = await sync.loadState();
      const disk = await sync.files.list();
      const database = (await sync.database.list(sync.state, disk))[key];
      const file = disk[key];
      return {
        key,
        file: preview(file?.value),
        database: preview(database?.value),
        fileHash: hash(file?.value),
        databaseHash: hash(database?.value),
        error: file?.error || null,
      };
    })
  );
}

function preview(value) {
  if (value == null || typeof value === "string") return value ?? null;
  if (!value.skillMd) return require("yaml").stringify(value, { lineWidth: 0 });
  const resources = Object.entries(value.files || {}).map(([name, encoded]) => {
    const bytes = Buffer.from(encoded, "base64");
    const digest = require("crypto")
      .createHash("sha256")
      .update(bytes)
      .digest("hex");
    const content = bytes.includes(0)
      ? "[二进制文件]"
      : bytes.toString("utf8").slice(0, 24000);
    return `\n--- ${name} (${bytes.length} bytes, SHA256 ${digest}) ---\n${content}${!bytes.includes(0) && bytes.toString("utf8").length > 24000 ? "\n[预览已截断，请在仓库中查看完整文件]" : ""}`;
  });
  return `${value.skillMd}\narchived: ${value.archived}\n${resources.join("\n")}`;
}

function start() {
  if (!enabled() || timer) return;
  const tick = async () => {
    try {
      await reconcile();
    } catch (error) {
      console.error(`[config-sync] ${error.message}`);
    }
    if (timer) {
      timer = setTimeout(tick, 2000);
      timer.unref();
    }
  };
  timer = setTimeout(tick, 0);
  timer.unref();
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

module.exports = {
  enabled,
  start,
  stop,
  status,
  reconcile,
  detail,
  synchronizeWrites,
};
