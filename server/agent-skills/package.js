const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const YAML = require("yaml");
const {
  workspaceFilesystemRoot,
} = require("../utils/workspaceAgentInstructions");

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_BINARY_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_PACKAGE_FILES = 1000;
const MAX_RESOURCE_READ_BYTES = 128 * 1024;

function storageRoot() {
  return process.env.STORAGE_DIR || path.resolve(__dirname, "../storage");
}

function globalSkillsRoot() {
  return path.join(storageRoot(), "agent-skills", "global");
}

function globalRevisionRoot(skillId, sha256) {
  return path.join(
    globalSkillsRoot(),
    String(Number(skillId)),
    "revisions",
    sha256
  );
}

function workspaceSkillsRoot(workspaceId) {
  const root = workspaceFilesystemRoot(workspaceId);
  if (!root) throw new Error("A valid workspace is required.");
  return path.join(root, ".agent", "skills");
}

function skillMarkdown({ name, description, body, manifest = {} }) {
  const frontmatter = {
    name,
    description,
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.compatibility
      ? { compatibility: manifest.compatibility }
      : {}),
    ...(manifest.metadata && Object.keys(manifest.metadata).length
      ? { metadata: manifest.metadata }
      : {}),
    ...(manifest.allowedTools
      ? { "allowed-tools": manifest.allowedTools }
      : {}),
  };
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${String(
    body || ""
  ).trim()}\n`;
}

function parseSkillMarkdown(source, { directoryName = null } = {}) {
  const text = String(source || "").replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  const errors = [];
  const warnings = [];
  if (!match)
    return {
      valid: false,
      errors: ["SKILL.md must begin with YAML frontmatter."],
      warnings,
      manifest: null,
      body: "",
      source: text,
    };

  let manifest;
  try {
    manifest = YAML.parse(match[1]);
  } catch (error) {
    return {
      valid: false,
      errors: [`Invalid YAML frontmatter: ${error.message}`],
      warnings,
      manifest: null,
      body: match[2],
      source: text,
    };
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("YAML frontmatter must be a mapping.");
    manifest = {};
  }

  const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
  const description =
    typeof manifest.description === "string" ? manifest.description.trim() : "";
  if (!name) errors.push("name is required.");
  else if (name.length > 64 || !SKILL_NAME_PATTERN.test(name))
    errors.push(
      "name must be 1-64 lowercase letters, numbers, or single hyphens."
    );
  if (directoryName && name && directoryName !== name)
    errors.push(`name must match its directory (${directoryName}).`);
  if (!description) errors.push("description is required.");
  else if (description.length > 1024)
    errors.push("description must not exceed 1024 characters.");
  if (
    manifest.compatibility != null &&
    (typeof manifest.compatibility !== "string" ||
      manifest.compatibility.length > 500)
  )
    errors.push("compatibility must be a string of at most 500 characters.");
  if (manifest.license != null && typeof manifest.license !== "string")
    errors.push("license must be a string.");
  if (
    manifest["allowed-tools"] != null &&
    typeof manifest["allowed-tools"] !== "string"
  )
    errors.push("allowed-tools must be a space-separated string.");
  if (manifest.metadata != null) {
    if (
      typeof manifest.metadata !== "object" ||
      Array.isArray(manifest.metadata)
    ) {
      errors.push("metadata must be a string-to-string mapping.");
    } else if (
      Object.values(manifest.metadata).some(
        (value) => typeof value !== "string"
      )
    ) {
      errors.push("Every metadata value must be a string.");
    }
  }

  const body = match[2].trim();
  const lines = body ? body.split("\n").length : 0;
  if (lines > 500)
    warnings.push(
      `SKILL.md body has ${lines} lines; the specification recommends fewer than 500.`
    );

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: {
      ...manifest,
      name,
      description,
      license: manifest.license || null,
      compatibility: manifest.compatibility || null,
      metadata: manifest.metadata || {},
      allowedTools: manifest["allowed-tools"] || "",
    },
    body,
    source: text,
  };
}

function normalizePackagePath(value, { allowSkillManifest = false } = {}) {
  const raw = String(value || "")
    .replace(/\\/g, "/")
    .trim();
  if (
    !raw ||
    raw.includes("\0") ||
    raw.startsWith("/") ||
    /^[A-Za-z]:/.test(raw)
  )
    throw new Error("Package paths must be relative POSIX paths.");
  const normalized = path.posix.normalize(raw);
  if (
    normalized === "." ||
    (!allowSkillManifest && normalized === "SKILL.md") ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  )
    throw new Error(`Invalid package path: ${raw}`);
  return normalized;
}

function isProbablyText(buffer) {
  if (!buffer.length) return true;
  if (buffer.includes(0)) return false;
  const decoded = buffer.toString("utf8");
  return (decoded.match(/\uFFFD/g) || []).length / decoded.length < 0.01;
}

async function walkPackage(root) {
  const files = [];
  const caseInsensitivePaths = new Set();
  let totalBytes = 0;
  async function walk(directory, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stats = await fs.lstat(absolute);
      if (stats.isSymbolicLink())
        throw new Error(`Symbolic links are not allowed: ${relative}`);
      if (stats.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!stats.isFile())
        throw new Error(`Unsupported package entry: ${relative}`);
      const collisionKey = relative.toLocaleLowerCase("en-US");
      if (caseInsensitivePaths.has(collisionKey))
        throw new Error(`Package contains case-colliding paths: ${relative}`);
      caseInsensitivePaths.add(collisionKey);
      totalBytes += stats.size;
      if (files.length + 1 > MAX_PACKAGE_FILES)
        throw new Error(
          `A skill may contain at most ${MAX_PACKAGE_FILES} files.`
        );
      if (totalBytes > MAX_PACKAGE_BYTES)
        throw new Error("Skill package exceeds the 100 MiB limit.");
      const content = await fs.readFile(absolute);
      const text = isProbablyText(content);
      const limit = text ? MAX_TEXT_FILE_BYTES : MAX_BINARY_FILE_BYTES;
      if (content.length > limit)
        throw new Error(`${relative} exceeds its per-file size limit.`);
      files.push({
        path: relative.split(path.sep).join("/"),
        size: content.length,
        text,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      });
    }
  }
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function packageHash(root, fileManifest = null) {
  const files = fileManifest || (await walkPackage(root));
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(`${file.path}\0${file.sha256}\0`);
  }
  return hash.digest("hex");
}

async function loadPackage(root, options = {}) {
  const skillPath = path.join(root, "SKILL.md");
  const source = await fs.readFile(skillPath, "utf8");
  const parsed = parseSkillMarkdown(source, options);
  const files = await walkPackage(root);
  const sha256 = await packageHash(root, files);
  return { ...parsed, root, files, sha256 };
}

async function packageForEditor(root, options = {}) {
  const pkg = await loadPackage(root, options);
  const files = [];
  for (const item of pkg.files) {
    if (item.path === "SKILL.md") continue;
    const value = { ...item, content: null, encoding: null };
    if (item.text) {
      value.content = await fs.readFile(path.join(root, item.path), "utf8");
      value.encoding = "utf8";
    }
    files.push(value);
  }
  return { ...pkg, files };
}

async function applyPackageInput(stage, input, baseRoot = null) {
  if (baseRoot) await fs.cp(baseRoot, stage, { recursive: true, force: true });
  else await fs.mkdir(stage, { recursive: true });

  for (const value of input.deletedPaths || []) {
    const relative = normalizePackagePath(value);
    await fs.rm(path.join(stage, relative), { recursive: true, force: true });
  }
  await fs.writeFile(path.join(stage, "SKILL.md"), input.skillMd, "utf8");
  for (const file of input.files || []) {
    const relative = normalizePackagePath(file.path);
    const target = path.join(stage, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const content =
      file.encoding === "base64"
        ? Buffer.from(String(file.content || ""), "base64")
        : Buffer.from(String(file.content || ""), "utf8");
    await fs.writeFile(target, content);
  }
  return loadPackage(
    stage,
    input.directoryName ? { directoryName: input.directoryName } : {}
  );
}

async function saveGlobalRevision(skillId, input, baseRoot = null) {
  const root = globalSkillsRoot();
  const stagingRoot = path.join(root, ".staging");
  await fs.mkdir(stagingRoot, { recursive: true });
  const stage = await fs.mkdtemp(path.join(stagingRoot, `${skillId}-`));
  try {
    const pkg = await applyPackageInput(stage, input, baseRoot);
    if (!pkg.valid) throw new Error(pkg.errors.join(" "));
    const destination = globalRevisionRoot(skillId, pkg.sha256);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.rename(stage, destination);
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      await fs.rm(stage, { recursive: true, force: true });
    }
    return { ...pkg, root: destination };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function saveWorkspacePackage(workspaceId, input, previousName = null) {
  const parsed = parseSkillMarkdown(input.skillMd);
  if (!parsed.valid) throw new Error(parsed.errors.join(" "));
  if (previousName != null && !SKILL_NAME_PATTERN.test(String(previousName)))
    throw new Error("Invalid previous workspace skill name.");
  const root = workspaceSkillsRoot(workspaceId);
  await fs.mkdir(root, { recursive: true });
  const destination = path.join(root, parsed.manifest.name);
  const baseName = previousName || parsed.manifest.name;
  const baseRoot = path.join(root, baseName);
  if (baseName !== parsed.manifest.name) {
    const collision = await fs
      .lstat(destination)
      .then(() => true)
      .catch(() => false);
    if (collision)
      throw new Error("A workspace skill with this name already exists.");
  }
  const stage = await fs.mkdtemp(path.join(root, ".editing-"));
  let backup = null;
  try {
    const baseExists = await fs
      .lstat(baseRoot)
      .then((stats) => stats.isDirectory() && !stats.isSymbolicLink())
      .catch(() => false);
    const pkg = await applyPackageInput(
      stage,
      {
        ...input,
        directoryName: parsed.manifest.name,
      },
      baseExists ? baseRoot : null
    );
    if (!pkg.valid) throw new Error(pkg.errors.join(" "));
    backup = `${destination}.replaced-${crypto.randomUUID()}`;
    const destinationExists = await fs
      .lstat(destination)
      .then(() => true)
      .catch(() => false);
    if (destinationExists) await fs.rename(destination, backup);
    await fs.rename(stage, destination);
    await fs.rm(backup, { recursive: true, force: true });
    if (baseName !== parsed.manifest.name)
      await fs.rm(baseRoot, { recursive: true, force: true });
    return { ...pkg, root: destination };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    if (backup) {
      const [backupExists, destinationExists] = await Promise.all([
        fs
          .lstat(backup)
          .then(() => true)
          .catch(() => false),
        fs
          .lstat(destination)
          .then(() => true)
          .catch(() => false),
      ]);
      if (backupExists && !destinationExists)
        await fs.rename(backup, destination).catch(() => null);
    }
    throw error;
  }
}

async function workspaceSkillNameExists(name) {
  const normalized = String(name || "");
  if (!SKILL_NAME_PATTERN.test(normalized)) return false;
  const workspacesRoot = path.join(
    storageRoot(),
    "anythingllm-fs",
    "workspaces"
  );
  let entries;
  try {
    entries = await fs.readdir(workspacesRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillRoot = path.join(
      workspacesRoot,
      entry.name,
      ".agent",
      "skills",
      normalized
    );
    const isPackage = await fs
      .lstat(path.join(skillRoot, "SKILL.md"))
      .then((stats) => stats.isFile() && !stats.isSymbolicLink())
      .catch(() => false);
    if (isPackage) return true;
  }
  return false;
}

async function listWorkspacePackages(workspaceId) {
  const root = workspaceSkillsRoot(workspaceId);
  await fs.mkdir(root, { recursive: true });
  const packages = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const pkg = await loadPackage(path.join(root, entry.name), {
        directoryName: entry.name,
      });
      packages.push({ ...pkg, scope: "workspace", directoryName: entry.name });
    } catch (error) {
      packages.push({
        valid: false,
        errors: [error.message],
        warnings: [],
        manifest: { name: entry.name, description: "" },
        body: "",
        files: [],
        sha256: null,
        root: path.join(root, entry.name),
        scope: "workspace",
        directoryName: entry.name,
      });
    }
  }
  return packages.sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name)
  );
}

async function resolveWorkspacePackage(workspaceId, name) {
  const normalized = String(name || "");
  if (!SKILL_NAME_PATTERN.test(normalized)) return null;
  const root = path.join(workspaceSkillsRoot(workspaceId), normalized);
  try {
    return await loadPackage(root, { directoryName: normalized });
  } catch {
    return null;
  }
}

async function readPackageResource(root, resourcePath, offset = 0) {
  const relative = normalizePackagePath(resourcePath, {
    allowSkillManifest: true,
  });
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`))
    throw new Error("Resource path escapes the skill package.");
  const stats = await fs.lstat(absolute);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error("Skill resource is not a regular file.");
  const handle = await fs.open(absolute, "r");
  try {
    const start = Math.max(0, Number(offset) || 0);
    const buffer = Buffer.alloc(
      Math.min(MAX_RESOURCE_READ_BYTES, Math.max(0, stats.size - start))
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const content = buffer.subarray(0, bytesRead);
    if (!isProbablyText(content))
      return {
        path: relative,
        binary: true,
        size: stats.size,
        content: null,
        nextOffset: null,
      };
    return {
      path: relative,
      binary: false,
      size: stats.size,
      content: content.toString("utf8"),
      nextOffset: start + bytesRead < stats.size ? start + bytesRead : null,
    };
  } finally {
    await handle.close();
  }
}

module.exports = {
  MAX_BINARY_FILE_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
  MAX_RESOURCE_READ_BYTES,
  MAX_TEXT_FILE_BYTES,
  SKILL_NAME_PATTERN,
  globalRevisionRoot,
  globalSkillsRoot,
  listWorkspacePackages,
  loadPackage,
  normalizePackagePath,
  packageForEditor,
  parseSkillMarkdown,
  readPackageResource,
  resolveWorkspacePackage,
  saveGlobalRevision,
  saveWorkspacePackage,
  skillMarkdown,
  workspaceSkillNameExists,
  workspaceSkillsRoot,
};
