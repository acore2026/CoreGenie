const path = require("path");
const fs = require("fs/promises");
const { z } = require("zod");
const { defineTool } = require("./descriptor");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");

function manager(context) {
  return filesystem.forWorkspace(context.workspace.id);
}

function skillUriResult(requestedPath) {
  const raw = String(requestedPath || "")
    .trim()
    .replace(/\\/g, "/");
  const match = raw.match(/^skill:\/{1,2}([^/]+)(?:\/(.*))?$/i);
  if (!match) return null;
  const [, name, resourcePath] = match;
  const instruction = resourcePath
    ? `Use read_skill_resource with name="${name}" and path="${resourcePath}".`
    : `Use the files list returned by activate_skill for "${name}", then call read_skill_resource with one of those exact paths.`;
  return {
    ok: false,
    code: "SKILL_URI_NOT_WORKSPACE_PATH",
    summary: `${raw} is a Skill package URI, not a workspace filesystem path. ${instruction}`,
    data: {
      requestedPath: raw,
      skillName: name,
      resourcePath: resourcePath || null,
    },
    retryable: false,
  };
}

async function missingFileResult(workspaceFs, requestedPath, error) {
  const message = String(error?.message || error || "");
  if (error?.code !== "ENOENT" && !message.includes("ENOENT")) throw error;
  const root = workspaceFs.getAllowedDirectories()[0];
  let suggestions = [];
  if (root) {
    suggestions = await workspaceFs
      .searchFilesWithGlob(root, path.basename(requestedPath), {
        maxResults: 5,
      })
      .then((matches) =>
        matches
          .slice(0, 5)
          .map((match) => path.relative(root, match).split(path.sep).join("/"))
      )
      .catch(() => []);
  }
  return {
    ok: false,
    code: "WORKSPACE_FILE_NOT_FOUND",
    summary: suggestions.length
      ? `The exact path ${requestedPath} does not exist. Reuse one of the resolved workspace paths instead of guessing another directory.`
      : `The exact path ${requestedPath} does not exist. Use filesystem.search or filesystem.list before retrying.`,
    data: { requestedPath, suggestions },
    retryable: false,
  };
}

const readFile = defineTool({
  id: "filesystem.read",
  name: "filesystem_read",
  description:
    "Read a workspace file by exact relative path or its sandbox path under /workspace, optionally limiting it to the first or last lines.",
  schema: z.object({
    path: z.string().min(1),
    head: z.number().int().positive().optional(),
    tail: z.number().int().positive().optional(),
  }),
  action: false,
  execute: async ({ path: filePath, head, tail }, context) => {
    if (head && tail) throw new Error("Use either head or tail, not both.");
    const skillUri = skillUriResult(filePath);
    if (skillUri) return skillUri;
    const workspaceFs = manager(context);
    const target = await workspaceFs.validatePath(filePath);
    try {
      if (head) return await workspaceFs.headFile(target, head);
      if (tail) return await workspaceFs.tailFile(target, tail);
      return await workspaceFs.readFileContent(target);
    } catch (error) {
      return missingFileResult(workspaceFs, filePath, error);
    }
  },
});

const writeFile = defineTool({
  id: "filesystem.write",
  name: "filesystem_write",
  description:
    "Create, replace, or append to a UTF-8 text file in the persistent workspace. For long reports, write the header first and append sections in bounded chunks.",
  schema: z.object({
    path: z.string().min(1),
    content: z.string(),
    append: z.boolean().default(false),
  }),
  execute: async ({ path: filePath, content, append }, context) => {
    const skillUri = skillUriResult(filePath);
    if (skillUri) return skillUri;
    const workspaceFs = manager(context);
    const target = await workspaceFs.validatePath(filePath);
    if (append) await fs.appendFile(target, content, "utf8");
    else await workspaceFs.writeFileContent(target, content);
    return `${append ? "Appended" : "Wrote"} ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}.`;
  },
});

const listDirectory = defineTool({
  id: "filesystem.list",
  name: "filesystem_list",
  description:
    "List files and folders using a workspace-relative path or a sandbox path under /workspace.",
  schema: z.object({ path: z.string().default(".") }),
  action: false,
  execute: async ({ path: directory }, context) => {
    const skillUri = skillUriResult(directory);
    if (skillUri) return skillUri;
    const workspaceFs = manager(context);
    const target = await workspaceFs.validatePath(directory);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  },
});

const deletePath = defineTool({
  id: "filesystem.delete",
  name: "filesystem_delete",
  description: "Delete a file or directory from the persistent workspace.",
  schema: z.object({
    path: z.string().min(1),
    recursive: z.boolean().default(false),
  }),
  execute: async ({ path: requestedPath, recursive }, context) => {
    const skillUri = skillUriResult(requestedPath);
    if (skillUri) return skillUri;
    const workspaceFs = manager(context);
    await workspaceFs.deletePath(requestedPath, { recursive });
    return `Deleted ${path.normalize(requestedPath)}.`;
  },
});

const searchFiles = defineTool({
  id: "filesystem.search",
  name: "filesystem_search",
  description:
    "Search persistent workspace paths using a relative or /workspace root and a glob such as **/*.md.",
  schema: z.object({
    root: z.string().default("."),
    pattern: z.string().min(1),
    max_results: z.number().int().min(1).max(500).default(100),
  }),
  action: false,
  execute: async ({ root, pattern, max_results }, context) => {
    const skillUri = skillUriResult(root);
    if (skillUri) return skillUri;
    const workspaceFs = manager(context);
    const target = await workspaceFs.validatePath(root);
    const results = await workspaceFs.searchFilesWithGlob(target, pattern, {
      maxResults: max_results,
    });
    return results;
  },
});

module.exports = {
  readFile,
  writeFile,
  listDirectory,
  deletePath,
  searchFiles,
};
