const fs = require("fs/promises");
const path = require("path");
const { getType } = require("mime");
const { AgentRunArtifact } = require("../models/agentRunArtifact");
const { workspaceFileRelativePath } = require("./attachments");

const MAX_REFERENCED_ARTIFACTS = 500;
const MAX_INLINE_REPORT_BYTES = 64 * 1024;
const INLINE_REPORT_EXTENSIONS = new Set([".md", ".txt", ".csv"]);

function requestNeedsInlineDataset(value) {
  return /(?:列出|列明|逐项|每(?:个|篇|条)|完整清单|list(?:\s+all)?|each|every|rows?|fields?)/i.test(
    String(value || "")
  );
}

function tabularRowCount(value) {
  const lines = String(value || "").split(/\r?\n/);
  const markdownRows = lines.filter(
    (line) =>
      /^\s*\|.*\|\s*$/.test(line) &&
      !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)
  ).length;
  const csvRows = lines.filter((line) => /,/.test(line)).length;
  return Math.max(markdownRows, csvRows);
}

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

async function completeInlineDatasetResponse({
  request,
  responseText,
  artifacts = [],
  workspaceManager,
}) {
  if (!requestNeedsInlineDataset(request))
    return { text: responseText, addition: "" };
  const currentRows = tabularRowCount(responseText);
  let best = null;
  for (const artifact of artifacts) {
    const relative = workspaceFileRelativePath(artifact.storagePath);
    if (!relative || !INLINE_REPORT_EXTENSIONS.has(path.extname(relative)))
      continue;
    try {
      const absolute = await workspaceManager.validatePath(relative);
      const stats = await fs.stat(absolute);
      if (!stats.isFile() || stats.size > MAX_INLINE_REPORT_BYTES) continue;
      const content = await fs.readFile(absolute, "utf8");
      const rows = tabularRowCount(content);
      if (rows <= currentRows + 2 || (best && rows <= best.rows)) continue;
      best = { content, rows };
    } catch {
      // Ignore an unavailable or non-text report candidate.
    }
  }
  if (!best) return { text: responseText, addition: "" };
  const addition = `\n\n---\n\n以下是工作区报告中的完整清单：\n\n${best.content.trim()}`;
  return { text: `${responseText.trimEnd()}${addition}`, addition };
}

module.exports = {
  completeInlineDatasetResponse,
  MAX_REFERENCED_ARTIFACTS,
  referencedWorkspacePaths,
  requestNeedsInlineDataset,
  registerReferencedArtifacts,
  tabularRowCount,
};
