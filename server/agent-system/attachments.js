const fs = require("fs/promises");
const path = require("path");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");

const WORKSPACE_FILE_MIME = "application/anythingllm-workspace-file";
const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;

function workspaceFileRelativePath(value) {
  const requested = String(value || "")
    .replace(/^\/workspace\/?/, "")
    .replaceAll("\\", "/")
    .trim();
  if (
    !requested ||
    requested.includes("\x00") ||
    path.posix.isAbsolute(requested)
  )
    return null;
  if (requested.split("/").some((segment) => segment === "..")) return null;
  const normalized = path.posix.normalize(requested);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  )
    return null;
  return normalized;
}

async function normalizeAgentAttachments({ attachments = [], workspace }) {
  if (!Array.isArray(attachments)) return [];
  const workspaceFiles = attachments.filter(
    (attachment) => attachment?.mime === WORKSPACE_FILE_MIME
  );
  if (!workspaceFiles.length) return attachments;
  const manager = filesystem.forWorkspace(workspace?.id);
  await manager.ensureInitialized();
  const validated = new Map();
  for (const attachment of workspaceFiles) {
    const relative = workspaceFileRelativePath(attachment.contentString);
    if (!relative) throw new Error("工作区文件路径无效，请重新选择文件。");
    const absolute = await manager.validatePath(relative);
    const stats = await fs.stat(absolute);
    if (!stats.isFile() || stats.size > MAX_WORKSPACE_FILE_BYTES)
      throw new Error("工作区文件不存在或超过 50 MiB，请重新选择文件。");
    validated.set(attachment, {
      name: path.basename(relative),
      mime: WORKSPACE_FILE_MIME,
      contentString: `/workspace/${relative}`,
    });
  }
  return attachments.map(
    (attachment) => validated.get(attachment) || attachment
  );
}

module.exports = {
  WORKSPACE_FILE_MIME,
  workspaceFileRelativePath,
  normalizeAgentAttachments,
};
