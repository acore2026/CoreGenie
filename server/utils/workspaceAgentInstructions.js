const fs = require("fs/promises");
const path = require("path");

const WORKSPACE_AGENT_FILENAME = "agent.md";
const MAX_WORKSPACE_AGENT_BYTES = 32 * 1024;

function workspaceFilesystemRoot(workspaceId) {
  const parsed = Number(workspaceId);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  const storageRoot =
    process.env.STORAGE_DIR || path.resolve(__dirname, "../storage");
  return path.join(
    storageRoot,
    "anythingllm-fs",
    "workspaces",
    `workspace-${parsed}`
  );
}

async function loadWorkspaceAgentInstructions(workspace) {
  const root = workspaceFilesystemRoot(workspace?.id);
  if (!root) return "";
  const instructionPath = path.join(root, WORKSPACE_AGENT_FILENAME);
  let handle;

  try {
    const stats = await fs.lstat(instructionPath);
    if (!stats.isFile() || stats.isSymbolicLink()) return "";

    handle = await fs.open(instructionPath, "r");
    const bytesToRead = Math.min(stats.size, MAX_WORKSPACE_AGENT_BYTES + 1);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const truncated = stats.size > MAX_WORKSPACE_AGENT_BYTES;
    const content = buffer
      .subarray(0, Math.min(bytesRead, MAX_WORKSPACE_AGENT_BYTES))
      .toString("utf8")
      .trim();
    if (!content) return "";
    return truncated
      ? `${content}\n\n[agent.md truncated at ${MAX_WORKSPACE_AGENT_BYTES} bytes]`
      : content;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code))
      console.warn(
        `[workspace-agent-instructions] Could not read workspace ${workspace.id} agent.md: ${error.message}`
      );
    return "";
  } finally {
    await handle?.close().catch(() => null);
  }
}

module.exports = {
  MAX_WORKSPACE_AGENT_BYTES,
  WORKSPACE_AGENT_FILENAME,
  loadWorkspaceAgentInstructions,
  workspaceFilesystemRoot,
};
