const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const YAML = require("yaml");
const { loadPackage, parseSkillMarkdown } = require("../agent-skills/package");
const { hash } = require("./engine");

const KEY = /^(agents|skills)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
function validKey(key) {
  if (key !== "global-prompt" && !KEY.test(key))
    throw new Error("无效的配置标识。");
}

async function assertSafe(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("配置路径超出同步目录。");
  let current = root;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error("同步目录中不能使用符号链接。");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function atomicWrite(target, content, beforeReplace = null) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.sync-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporary, content);
    if (beforeReplace) await beforeReplace();
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function skillSource(source) {
  const parsed = parseSkillMarkdown(source);
  if (!parsed.valid) throw new Error(parsed.errors.join(" "));
  if (
    parsed.manifest.archived != null &&
    typeof parsed.manifest.archived !== "boolean"
  )
    throw new Error("archived 必须是 true 或 false。");
  const match = source
    .replace(/\r\n/g, "\n")
    .match(/^---\n([\s\S]*?)\n---([\s\S]*)$/);
  return {
    skillMd: `---\n${match[1].replace(/^archived:[^\n]*(?:\n|$)/m, "")}\n---${match[2]}`,
    archived: parsed.manifest.archived === true,
  };
}

class ConfigFiles {
  constructor(root) {
    this.root = path.resolve(root);
  }

  target(key) {
    validKey(key);
    return path.join(
      this.root,
      key === "global-prompt"
        ? "global-prompt.md"
        : key.startsWith("agents/")
          ? `${key}.yaml`
          : key
    );
  }

  async read(key) {
    const target = this.target(key);
    await assertSafe(this.root, target);
    if (key.startsWith("skills/")) {
      const pkg = await loadPackage(target);
      if (!pkg.valid) throw new Error(pkg.errors.join(" "));
      const files = {};
      for (const file of pkg.files) {
        if (file.path === "SKILL.md") continue;
        files[file.path] = (
          await fs.readFile(path.join(target, file.path))
        ).toString("base64");
      }
      return { ...skillSource(pkg.source), files };
    }
    if ((await fs.stat(target)).size > 1024 * 1024)
      throw new Error("配置文件不能超过 1 MiB。");
    const source = await fs.readFile(target, "utf8");
    if (key === "global-prompt") {
      if (source.length > 40000)
        throw new Error("全局提示词不能超过 40000 字符。");
      return source.trim();
    }
    const value = YAML.parse(source, { uniqueKeys: true, maxAliasCount: 0 });
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Agent 配置必须是 YAML 对象。");
    return require("./database").agentValue(value);
  }

  async list() {
    await assertSafe(this.root, this.root);
    const values = {};
    const keys = ["global-prompt"];
    for (const kind of ["agents", "skills"]) {
      const directory = path.join(this.root, kind);
      await assertSafe(this.root, directory);
      const entries = await fs
        .readdir(directory, { withFileTypes: true })
        .catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
      for (const entry of entries) {
        if (kind === "skills" && entry.name.startsWith(".backup-")) {
          const target = path.join(directory, entry.name.slice(8));
          await assertSafe(this.root, target);
          const exists = await fs
            .lstat(target)
            .then(() => true)
            .catch((error) => {
              if (error.code === "ENOENT") return false;
              throw error;
            });
          if (!exists) {
            await fs.rename(path.join(directory, entry.name), target);
            keys.push(`skills/${entry.name.slice(8)}`);
          }
          continue;
        }
        if (entry.name.startsWith(".")) continue;
        if (kind === "agents" && !entry.name.endsWith(".yaml")) continue;
        const key = `${kind}/${kind === "agents" ? entry.name.slice(0, -5) : entry.name}`;
        keys.push(key);
      }
    }
    for (const key of keys) {
      try {
        values[key] = { value: await this.read(key) };
      } catch (error) {
        // A missing SKILL.md is an incomplete package, not a deleted definition.
        if (error.code === "ENOENT" && !key.startsWith("skills/")) continue;
        values[key] = { error: error.message };
      }
    }
    return values;
  }

  async verify(key, expected) {
    let current = null;
    try {
      current = hash(await this.read(key));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current !== expected)
      throw new Error("文件仍在修改，将在下次扫描时重试。");
  }

  async write(key, value, expectedHash) {
    const target = this.target(key);
    await assertSafe(this.root, target);
    if (!key.startsWith("skills/")) {
      await atomicWrite(
        target,
        key === "global-prompt"
          ? value
          : YAML.stringify(value, { lineWidth: 0 }),
        expectedHash === undefined ? null : () => this.verify(key, expectedHash)
      );
      return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const stage = await fs.mkdtemp(path.join(path.dirname(target), ".sync-"));
    const backup = path.join(
      path.dirname(target),
      `.backup-${path.basename(target)}`
    );
    try {
      const source = value.skillMd.replace(
        /^---\n/,
        `---\narchived: ${value.archived === true}\n`
      );
      await fs.writeFile(path.join(stage, "SKILL.md"), source);
      for (const [name, content] of Object.entries(value.files)) {
        const { normalizePackagePath } = require("../agent-skills/package");
        const destination = path.join(stage, normalizePackagePath(name));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, Buffer.from(content, "base64"));
      }
      // The backup also makes a crash between directory renames recoverable.
      if (expectedHash !== undefined) await this.verify(key, expectedHash);
      await assertSafe(this.root, backup);
      // A prior completed replacement may have left its backup after a crash.
      await fs.rm(backup, { recursive: true, force: true });
      await fs.rename(target, backup).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fs.rename(stage, target);
      await fs.rm(backup, { recursive: true, force: true });
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
}

module.exports = { ConfigFiles, atomicWrite, skillSource, validKey };
