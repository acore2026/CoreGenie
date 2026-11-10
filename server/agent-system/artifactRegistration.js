const fs = require("fs/promises");
const path = require("path");
const { getType } = require("mime");
const { AgentRunArtifact } = require("../models/agentRunArtifact");
const { workspaceFileRelativePath } = require("./attachments");

const MAX_REFERENCED_ARTIFACTS = 500;
const MAX_INLINE_REPORT_BYTES = 64 * 1024;
const INLINE_REPORT_EXTENSIONS = new Set([".md", ".txt", ".csv"]);

function outputRelativePath(value) {
  const relative = workspaceFileRelativePath(value)?.replace(/\/+$/, "");
  // Internal runtime files are not deliverables. Never offer the workspace root.
  if (
    !relative ||
    relative
      .split("/")
      .some(
        (part) =>
          part.startsWith(".") ||
          part.endsWith(".assets") ||
          ["_meta", "_tmp", "tmp"].includes(part)
      )
  )
    return null;
  return relative;
}

async function registerWorkspaceOutputs({
  runId,
  references,
  workspaceManager,
}) {
  if (!references.length) return [];
  const existing = await AgentRunArtifact.forRun(runId);
  const byPath = new Map(
    existing.map((item) => [outputRelativePath(item.storagePath), item])
  );
  const registered = new Map();
  for (const reference of references) {
    const relative = outputRelativePath(reference.storagePath);
    if (!relative || registered.has(relative)) continue;
    try {
      const absolute = await workspaceManager.validatePath(relative);
      const stats = await fs.stat(absolute);
      const directory = stats.isDirectory?.() === true;
      if (!stats.isFile() && !directory) continue;
      const previous = byPath.get(relative);
      const filename = `${path.posix.basename(relative)}${directory ? ".zip" : ""}`;
      const artifact =
        previous ||
        (await AgentRunArtifact.registerWorkspaceOutput({
          runId,
          taskId: reference.taskId,
          kind: directory ? "workspaceDirectory" : "workspaceFile",
          title: filename,
          mimeType: directory
            ? "application/zip"
            : getType(relative) || "application/octet-stream",
          storagePath: relative,
          byteSize: directory ? 0 : stats.size,
          metadata: { filename, role: "agent-reported-output" },
        }));
      registered.set(relative, artifact);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code))
        console.warn(
          "[Agent artifacts] Unable to register output:",
          error.message
        );
    }
  }
  return [...registered.values()];
}

function toolOutputReferences(toolId, args, result) {
  if (toolId === "filesystem.write" && result.ok) return [args.path];
  if (toolId === "3gpp.download")
    return Array.isArray(result.data?.outputs)
      ? result.data.outputs.map((output) => output.directory)
      : referencedWorkspacePaths(result.data);
  if (["bash", "python", "3gpp.convert-markdown"].includes(toolId))
    return referencedWorkspacePaths(result.data);
  return [];
}

async function registerRunArtifacts({
  runId,
  tasks = [],
  finalResponse = "",
  workspaceManager,
}) {
  // Final reply links lead the list. Tool records also cover files omitted from
  // prose, default runtimes without write tasks, and runs resumed after upgrades.
  const references = referencedWorkspacePaths(finalResponse).map(
    (storagePath) => ({ storagePath })
  );
  for (const task of tasks.filter((task) => task.writeIntent))
    references.push(
      ...referencedWorkspacePaths(task.resultSummary).map((storagePath) => ({
        storagePath,
        taskId: task.id,
      }))
    );
  const executions =
    await require("../utils/prisma").agent_tool_executions.findMany({
      where: {
        run_id: String(runId),
        tool_id: {
          in: [
            "filesystem.write",
            "bash",
            "python",
            "3gpp.download",
            "3gpp.convert-markdown",
          ],
        },
        status: { in: ["completed", "failed"] },
      },
      select: { tool_id: true, task_id: true, arguments: true, result: true },
      orderBy: { createdAt: "asc" },
    });
  for (const execution of executions) {
    try {
      const args =
        execution.tool_id === "filesystem.write"
          ? JSON.parse(execution.arguments || "{}")
          : {};
      const result = JSON.parse(execution.result || "{}");
      for (const storagePath of toolOutputReferences(
        execution.tool_id,
        args,
        result
      ))
        if (storagePath)
          references.push({ storagePath, taskId: execution.task_id });
    } catch {
      /* Older unstructured tool records may not have usable paths. */
    }
  }
  return registerWorkspaceOutputs({ runId, references, workspaceManager });
}

async function registerToolArtifacts({ descriptor, args, result, context }) {
  const paths = toolOutputReferences(descriptor.id, args, result);
  if (!context.workspace?.id || (!paths.length && !result.artifactIds?.length))
    return [];
  const workspaceManager =
    require("../utils/agents/aibitat/plugins/filesystem/lib").forWorkspace(
      context.workspace.id
    );
  await workspaceManager.ensureInitialized();
  const registered = await registerWorkspaceOutputs({
    runId: context.run.id,
    workspaceManager,
    references: paths
      .filter(Boolean)
      .map((storagePath) => ({ storagePath, taskId: context.taskId })),
  });
  result.artifactIds = [
    ...new Set([
      ...(result.artifactIds || []),
      ...registered.map((item) => item.id),
    ]),
  ];
  const outputs = await collectRunOutputs({
    runId: context.run.id,
    workspace: context.workspace,
    workspaceManager,
  });
  if (outputs.length) await context.emit("artifacts.updated", { outputs });
  return registered;
}

function artifactOutput(artifact, workspace, stats) {
  const archive = artifact.kind === "workspaceDirectory";
  return {
    type: "workspaceFile",
    payload: {
      workspaceSlug: workspace.slug,
      path: artifact.storagePath,
      filename:
        artifact.metadata?.filename ||
        `${path.posix.basename(artifact.storagePath || artifact.title)}${archive ? ".zip" : ""}`,
      ...(archive ? { archive: true } : { fileSize: stats.size }),
      artifactId: artifact.id,
    },
  };
}

async function collectRunOutputs({
  runId,
  workspace,
  workspaceManager,
  artifacts,
}) {
  const outputs = [];
  const paths = new Set();
  for (const artifact of artifacts || (await AgentRunArtifact.forRun(runId))) {
    if (!["workspaceFile", "workspaceDirectory"].includes(artifact.kind))
      continue;
    const relative = outputRelativePath(artifact.storagePath);
    if (!relative || paths.has(relative)) continue;
    try {
      const stats = await fs.stat(
        await workspaceManager.validatePath(relative)
      );
      if (
        artifact.kind === "workspaceDirectory"
          ? !stats.isDirectory()
          : !stats.isFile()
      )
        continue;
      outputs.push(
        artifactOutput({ ...artifact, storagePath: relative }, workspace, stats)
      );
      paths.add(relative);
    } catch {
      /* Removed files are not downloadable. */
    }
  }
  return outputs.sort(
    (left, right) => outputPriority(left) - outputPriority(right)
  );
}

function outputPriority(output) {
  const value = output.payload.path;
  if (
    !output.payload.archive &&
    /(?:^|\/)(?:deliverables|reports|analysis)\//i.test(value)
  )
    return 0;
  if (
    !output.payload.archive &&
    /(?:report|报告|summary|总结|comparison|inventory|per-doc|对比|清单)/i.test(
      path.posix.basename(value)
    )
  )
    return 1;
  return output.payload.archive ? 2 : 3;
}

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

  const references = [];
  for (const task of writeTasks) {
    for (const storagePath of referencedWorkspacePaths(task.resultSummary))
      references.push({ storagePath, taskId: task.id });
  }
  for (const storagePath of referencedWorkspacePaths(finalResponse))
    references.push({ storagePath, taskId: null });

  return registerWorkspaceOutputs({ runId, references, workspaceManager });
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
  artifactOutput,
  collectRunOutputs,
  outputRelativePath,
  registerToolArtifacts,
  registerRunArtifacts,
  registerWorkspaceOutputs,
  toolOutputReferences,
  completeInlineDatasetResponse,
  MAX_REFERENCED_ARTIFACTS,
  referencedWorkspacePaths,
  requestNeedsInlineDataset,
  registerReferencedArtifacts,
  tabularRowCount,
};
