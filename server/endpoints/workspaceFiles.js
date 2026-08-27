const fs = require("fs/promises");
const path = require("path");
const archiver = require("archiver");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

function relativeWorkspacePath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative ? relative.split(path.sep).join("/") : "";
}

async function workspaceFilesystem(response) {
  const manager = filesystem.forWorkspace(response.locals.workspace.id);
  await manager.ensureInitialized();
  const [root] = manager.getAllowedDirectories();
  return { manager, root: await manager.validatePath(root) };
}

async function readChunk(filePath, maxBytes) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isProbablyText(buffer) {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  const decoded = buffer.toString("utf8");
  const replacementCount = (decoded.match(/\uFFFD/g) || []).length;
  return replacementCount / Math.max(decoded.length, 1) < 0.01;
}

function workspaceFileEndpoints(app) {
  if (!app) return;
  const middleware = [
    validatedRequest,
    flexUserRoleValid([ROLES.all]),
    validWorkspaceSlug,
  ];

  app.get("/workspace/:slug/files", middleware, async (request, response) => {
    try {
      const requestedPath = String(request.query.path || ".");
      const { manager, root } = await workspaceFilesystem(response);
      const directory = await manager.validatePath(requestedPath);
      const directoryStats = await fs.stat(directory);
      if (!directoryStats.isDirectory())
        return response.status(400).json({ error: "Path is not a directory." });

      const entries = [];
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        try {
          const absolutePath = await manager.validatePath(
            path.join(directory, entry.name)
          );
          const stats = await fs.stat(absolutePath);
          entries.push({
            name: entry.name,
            path: relativeWorkspacePath(root, absolutePath),
            type: stats.isDirectory() ? "directory" : "file",
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        } catch {
          // Do not reveal broken links or links escaping the workspace root.
        }
      }

      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

      return response.status(200).json({
        path: relativeWorkspacePath(root, directory),
        entries,
      });
    } catch (error) {
      const status = ["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 400;
      return response.status(status).json({ error: "Unable to open folder." });
    }
  });

  app.get(
    "/workspace/:slug/files/preview",
    middleware,
    async (request, response) => {
      try {
        const requestedPath = String(request.query.path || "");
        if (!requestedPath)
          return response.status(400).json({ error: "File path is required." });

        const { manager, root } = await workspaceFilesystem(response);
        const filePath = await manager.validatePath(requestedPath);
        const stats = await fs.stat(filePath);
        if (!stats.isFile())
          return response.status(400).json({ error: "Path is not a file." });

        const extension = path.extname(filePath).toLowerCase();
        const imageMime = IMAGE_MIME_TYPES[extension];
        const metadata = {
          name: path.basename(filePath),
          path: relativeWorkspacePath(root, filePath),
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };

        if (imageMime) {
          if (stats.size > MAX_IMAGE_PREVIEW_BYTES)
            return response.status(200).json({
              ...metadata,
              kind: "too_large",
              previewLimit: MAX_IMAGE_PREVIEW_BYTES,
            });
          const content = await fs.readFile(filePath);
          return response.status(200).json({
            ...metadata,
            kind: "image",
            mime: imageMime,
            content: content.toString("base64"),
          });
        }

        const content = await readChunk(filePath, MAX_TEXT_PREVIEW_BYTES);
        if (!isProbablyText(content))
          return response.status(200).json({ ...metadata, kind: "binary" });

        return response.status(200).json({
          ...metadata,
          kind: "text",
          content: content.subarray(0, MAX_TEXT_PREVIEW_BYTES).toString("utf8"),
          truncated: content.length > MAX_TEXT_PREVIEW_BYTES,
          previewLimit: MAX_TEXT_PREVIEW_BYTES,
        });
      } catch (error) {
        const status = error.code === "ENOENT" ? 404 : 400;
        return response
          .status(status)
          .json({ error: "Unable to preview file." });
      }
    }
  );

  app.get(
    "/workspace/:slug/files/download",
    middleware,
    async (request, response) => {
      try {
        const requestedPath = String(request.query.path || "");
        if (!requestedPath)
          return response.status(400).json({ error: "File path is required." });

        const { manager } = await workspaceFilesystem(response);
        const filePath = await manager.validatePath(requestedPath);
        const stats = await fs.stat(filePath);
        if (!stats.isFile())
          return response.status(400).json({ error: "Path is not a file." });

        return response.download(filePath, path.basename(filePath));
      } catch (error) {
        const status = error.code === "ENOENT" ? 404 : 400;
        return response
          .status(status)
          .json({ error: "Unable to download file." });
      }
    }
  );

  app.get(
    "/workspace/:slug/files/archive",
    middleware,
    async (request, response) => {
      try {
        const requestedPath = String(request.query.path || "");
        if (!requestedPath)
          return response
            .status(400)
            .json({ error: "Folder path is required." });

        const { manager } = await workspaceFilesystem(response);
        const directoryPath = await manager.validatePath(requestedPath);
        const stats = await fs.stat(directoryPath);
        if (!stats.isDirectory())
          return response.status(400).json({ error: "Path is not a folder." });

        const archiveName = `${path.basename(directoryPath) || "workspace"}.zip`;
        response.attachment(archiveName);
        response.type("application/zip");

        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("warning", (error) => {
          if (error.code === "ENOENT") {
            console.warn("Workspace folder archive warning:", error.message);
            return;
          }
          archive.emit("error", error);
        });
        archive.on("error", (error) => {
          console.error("Workspace folder archive failed:", error.message);
          if (!response.headersSent)
            response.status(500).json({ error: "Unable to archive folder." });
          else response.destroy(error);
        });
        response.on("close", () => {
          if (!response.writableEnded) archive.abort();
        });

        archive.pipe(response);
        archive.directory(directoryPath, false);
        await archive.finalize();
      } catch (error) {
        const status = error.code === "ENOENT" ? 404 : 400;
        if (!response.headersSent)
          return response
            .status(status)
            .json({ error: "Unable to download folder." });
        response.destroy(error);
      }
    }
  );
}

module.exports = { workspaceFileEndpoints };
