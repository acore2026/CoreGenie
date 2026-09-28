const fs = require("fs/promises");
const path = require("path");
const archiver = require("archiver");
const { v4: uuidv4 } = require("uuid");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { validApiKey } = require("../utils/middleware/validApiKey");
const filesystem = require("../utils/agents/aibitat/plugins/filesystem/lib");
const { handleWorkspaceFileUpload } = require("../utils/files/multer");
const { Workspace } = require("../models/workspace");

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
const WORKSPACE_DOCX_MIME = "application/anythingllm-workspace-file";

function safeWorkspaceFileName(value) {
  const original = String(value || "file");
  const utf8Candidate = Buffer.from(original, "latin1").toString("utf8");
  const decoded = (utf8Candidate.includes("\uFFFD") ? original : utf8Candidate)
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .trim();
  const filename = path.basename(decoded).slice(0, 180) || "file";
  return [".", ".."].includes(filename) ? "file" : filename;
}

function safeWorkspaceEntryName(value) {
  const name = String(value || "").trim();
  if (
    !name ||
    [".", ".."].includes(name) ||
    path.basename(name) !== name ||
    /[<>:"/\\|?*]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    Buffer.byteLength(name, "utf8") > 180
  )
    return null;
  return name;
}

function isInboxFilePath(value) {
  const normalized = String(value || "")
    .replace(/^\/workspace\/?/, "")
    .split(path.sep)
    .join("/");
  return /^3gpp-markdown\/inbox\/[^/]+\/[^/]+\.docx$/i.test(normalized)
    ? normalized
    : null;
}

function isRemovableUploadPath(value) {
  const normalized = String(value || "")
    .replace(/^\/workspace\/?/, "")
    .split(path.sep)
    .join("/");
  if (isInboxFilePath(normalized)) return normalized;
  return /^uploads\/[^/]+\/[^/]+$/i.test(normalized) ? normalized : null;
}

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

function registerWorkspaceFileRoutes(app, { prefix, middleware }) {
  if (!app) return;

  app.post(
    `${prefix}/upload`,
    [...middleware, handleWorkspaceFileUpload],
    async (request, response) => {
      try {
        if (!request.file)
          return response
            .status(400)
            .json({ success: false, error: "请选择文件。" });
        const filename = safeWorkspaceFileName(request.file.originalname);
        const { manager, root } = await workspaceFilesystem(response);
        const attachmentUpload = request.body?.destination === "attachment";
        const targetDirectory = attachmentUpload
          ? `uploads/${uuidv4()}`
          : String(request.body?.path || ".");
        const directory = await manager.validatePath(targetDirectory);
        if (!attachmentUpload) {
          const directoryStats = await fs.stat(directory);
          if (!directoryStats.isDirectory())
            return response
              .status(400)
              .json({ success: false, error: "上传位置不是文件夹。" });
        }
        const relative = path.join(targetDirectory, filename);
        const destination = await manager.validatePath(relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, request.file.buffer, { flag: "wx" });
        const stats = await fs.stat(destination);
        return response.status(200).json({
          success: true,
          file: {
            name: filename,
            path: relativeWorkspacePath(root, destination),
            mime: WORKSPACE_DOCX_MIME,
            size: stats.size,
          },
        });
      } catch (error) {
        if (error.code === "EEXIST")
          return response.status(409).json({
            success: false,
            error: "当前文件夹中已有同名文件。",
          });
        console.error("Workspace file upload failed:", error.message);
        return response
          .status(500)
          .json({ success: false, error: "文件保存失败，请重试。" });
      }
    }
  );

  app.delete(`${prefix}/upload`, middleware, async (request, response) => {
    try {
      const relative = isRemovableUploadPath(request.query.path);
      if (!relative)
        return response.status(400).json({
          success: false,
          error: "只能移除尚未发送的上传文件。",
        });
      const { manager } = await workspaceFilesystem(response);
      const target = await manager.validatePath(relative);
      const stats = await fs.stat(target);
      if (!stats.isFile())
        return response
          .status(400)
          .json({ success: false, error: "目标不是文件。" });
      await fs.unlink(target);
      await fs.rmdir(path.dirname(target)).catch(() => {});
      return response.status(200).json({ success: true });
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      return response
        .status(status)
        .json({ success: false, error: "文件不存在或已经移除。" });
    }
  });

  app.patch(prefix, middleware, async (request, response) => {
    try {
      const requestedPath = String(request.body?.path || "").trim();
      const name = safeWorkspaceEntryName(request.body?.name);
      if (!requestedPath || !name)
        return response.status(400).json({
          success: false,
          error: "请输入有效的文件或文件夹名称。",
        });

      const { manager, root } = await workspaceFilesystem(response);
      const source = path.resolve(root, requestedPath);
      await manager.validatePath(source);
      if (!relativeWorkspacePath(root, source))
        return response.status(400).json({
          success: false,
          error: "不能重命名工作区根目录。",
        });

      const stats = await fs.stat(source);
      const destination = path.resolve(path.dirname(source), name);
      await manager.validatePath(destination);
      if (destination === source)
        return response.status(200).json({
          success: true,
          entry: {
            name,
            path: relativeWorkspacePath(root, source),
            type: stats.isDirectory() ? "directory" : "file",
            size: stats.size,
            modified: stats.mtime.toISOString(),
          },
        });

      try {
        await fs.access(destination);
        return response.status(409).json({
          success: false,
          error: "当前文件夹中已有同名项目。",
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      await fs.rename(source, destination);
      const renamedStats = await fs.stat(destination);
      return response.status(200).json({
        success: true,
        entry: {
          name,
          path: relativeWorkspacePath(root, destination),
          type: renamedStats.isDirectory() ? "directory" : "file",
          size: renamedStats.size,
          modified: renamedStats.mtime.toISOString(),
        },
      });
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      return response.status(status).json({
        success: false,
        error:
          error.code === "ENOENT"
            ? "文件或文件夹不存在。"
            : "无法重命名，请重试。",
      });
    }
  });

  app.delete(prefix, middleware, async (request, response) => {
    try {
      const requestedPath = String(request.query.path || "").trim();
      if (!requestedPath)
        return response.status(400).json({
          success: false,
          error: "请选择要删除的文件或文件夹。",
        });

      const { manager, root } = await workspaceFilesystem(response);
      const target = path.resolve(root, requestedPath);
      await manager.validatePath(target);
      if (!relativeWorkspacePath(root, target))
        return response.status(400).json({
          success: false,
          error: "不能删除工作区根目录。",
        });

      const stats = await fs.lstat(target);
      if (stats.isDirectory()) await fs.rm(target, { recursive: true });
      else await fs.unlink(target);
      return response.status(200).json({ success: true });
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      return response.status(status).json({
        success: false,
        error:
          error.code === "ENOENT"
            ? "文件或文件夹不存在。"
            : "无法删除，请重试。",
      });
    }
  });

  app.get(prefix, middleware, async (request, response) => {
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

  app.get(`${prefix}/preview`, middleware, async (request, response) => {
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
      return response.status(status).json({ error: "Unable to preview file." });
    }
  });

  app.get(`${prefix}/download`, middleware, async (request, response) => {
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
  });

  app.get(`${prefix}/archive`, middleware, async (request, response) => {
    try {
      const requestedPath = String(request.query.path || "");
      if (!requestedPath)
        return response.status(400).json({ error: "Folder path is required." });

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
  });
}

async function loadApiWorkspace(request, response, next) {
  const workspace = await Workspace.get({ slug: String(request.params.slug) });
  if (!workspace)
    return response.status(404).json({ error: "Workspace not found." });
  response.locals.workspace = workspace;
  next();
}

function workspaceFileEndpoints(app) {
  registerWorkspaceFileRoutes(app, {
    prefix: "/workspace/:slug/files",
    middleware: [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceSlug,
    ],
  });
}

function apiWorkspaceFileEndpoints(app) {
  registerWorkspaceFileRoutes(app, {
    prefix: "/v1/workspace/:slug/files",
    middleware: [validApiKey, loadApiWorkspace],
  });
}

module.exports = {
  workspaceFileEndpoints,
  apiWorkspaceFileEndpoints,
  loadApiWorkspace,
  registerWorkspaceFileRoutes,
  safeWorkspaceFileName,
  safeWorkspaceEntryName,
  isInboxFilePath,
  isRemovableUploadPath,
};
