const fs = require("fs/promises");
const path = require("path");
const { getType } = require("mime");
const { AgentRunArtifact } = require("../models/agentRunArtifact");
const { workspaceFileRelativePath } = require("./attachments");

const MAX_REFERENCED_ARTIFACTS = 500;

function referencedWorkspacePaths(value) {
  const paths = new Set();
  const collect = (input) => {
    if (typeof input === "string") {
      const remaining = input.replace(
        /[`"'](\/workspace\/[^`"'\r\n]+)[`"']/g,
        (_match, workspacePath) => {
          paths.add(workspacePath);
          return " ";
        }
      );
      const plain = remaining.matchAll(/\/workspace\/[^\s`"'<>|]+/g);
      for (const match of plain) paths.add(match[0]);
      return;
    }
    if (Array.isArray(input)) return input.forEach(collect);
    if (input && typeof input === "object")
      Object.values(input).forEach(collect);
  };
  collect(value);
  return [...paths]
    .map((candidate) => candidate.replace(/[)\]}>，。；、,:;]+$/g, "").trim())
    .filter(
      (candidate) =>
        !["?", "*", "[", "]"].some((token) => candidate.includes(token))
    )
    .slice(0, MAX_REFERENCED_ARTIFACTS);
}

async function registerReferencedArtifacts({
  runId,
  tasks = [],
  finalResponse = "",
  workspaceManager,
}) {
  const writeTasks = tasks.filter((task) => task.writeIntent === true);
  if (!writeTasks.length) return [];

  const references = [];
  for (const task of writeTasks) {
    for (const storagePath of referencedWorkspacePaths(task.resultSummary))
      references.push({ storagePath, taskId: task.id });
  }
  for (const storagePath of referencedWorkspacePaths(finalResponse))
    references.push({ storagePath, taskId: null });

  const existing = await AgentRunArtifact.forRun(runId);
  const byPath = new Map(
    existing
      .filter((artifact) => artifact.kind === "workspaceFile")
      .map((artifact) => [artifact.storagePath, artifact])
  );
  for (const reference of references) {
    const relative = workspaceFileRelativePath(reference.storagePath);
    if (!relative || byPath.has(relative)) continue;
    try {
      const absolute = await workspaceManager.validatePath(relative);
      const stats = await fs.stat(absolute);
      if (!stats.isFile()) continue;
      const artifact = await AgentRunArtifact.create({
        runId,
        taskId: reference.taskId,
        kind: "workspaceFile",
        title: path.posix.basename(relative),
        mimeType: getType(relative) || "application/octet-stream",
        storagePath: relative,
        byteSize: stats.size,
        metadata: {
          filename: path.posix.basename(relative),
          role: "agent-reported-output",
        },
      });
      byPath.set(relative, artifact);
    } catch {
      // A reported path is not an output unless it resolves to a regular file.
    }
  }
  return [...byPath.values()];
}

module.exports = {
  MAX_REFERENCED_ARTIFACTS,
  referencedWorkspacePaths,
  registerReferencedArtifacts,
};
