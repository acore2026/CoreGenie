const fs = require("fs/promises");
const path = require("path");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");

const WORKSPACE_FILE_MIME = "application/anythingllm-workspace-file";
const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;

function workspaceFileRelativePath(value) {
  const normalized = String(value || "")
    .replace(/^\/workspace\/?/, "")
    .split(path.sep)
    .join("/");
  return /^3gpp-markdown\/inbox\/[^/]+\/[^/]+\.docx$/i.test(normalized)
    ? normalized
    : null;
}

async function normalizeAgentAttachments({
  attachments = [],
  workspace,
  agent,
}) {
  if (!Array.isArray(attachments)) return [];
  const workspaceFiles = attachments.filter(
    (attachment) => attachment?.mime === WORKSPACE_FILE_MIME
  );
  if (!workspaceFiles.length) return attachments;
  if (agent?.runtimeConfig?.attachmentMode !== "workspace_file")
    throw new Error(
      "当前助手不能读取原始 DOCX，请选择 3GPP 提案转 Markdown 助手。"
    );
  const manager = filesystem.forWorkspace(workspace?.id);
  await manager.ensureInitialized();
  const validated = new Map();
  for (const attachment of workspaceFiles) {
    const relative = workspaceFileRelativePath(attachment.contentString);
    if (!relative) throw new Error("DOCX 路径无效，请重新上传文件。");
    const absolute = await manager.validatePath(relative);
    const stats = await fs.stat(absolute);
    if (!stats.isFile() || stats.size > MAX_WORKSPACE_FILE_BYTES)
      throw new Error("DOCX 不存在或超过 50 MiB，请重新上传文件。");
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
