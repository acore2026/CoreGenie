const path = require("path");
const fs = require("fs/promises");
const { z } = require("zod");
const { defineTool } = require("./descriptor");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");

function manager(context) {
  return filesystem.forWorkspace(context.workspace.id);
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
    const workspaceFs = manager(context);
    const target = await workspaceFs.validatePath(filePath);
    if (head) return workspaceFs.headFile(target, head);
    if (tail) return workspaceFs.tailFile(target, tail);
    return workspaceFs.readFileContent(target);
  },
});

const writeFile = defineTool({
  id: "filesystem.write",
  name: "filesystem_write",
  description:
    "Create or replace a UTF-8 text file in the persistent workspace.",
  schema: z.object({ path: z.string().min(1), content: z.string() }),
  execute: async ({ path: filePath, content }, context) => {
    const workspaceFs = manager(context);
    const target = await workspaceFs.validatePath(filePath);
    await workspaceFs.writeFileContent(target, content);
    return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}.`;
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
