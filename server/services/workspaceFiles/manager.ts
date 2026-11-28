const fs = require("fs/promises");
const path = require("path");
const { humanFileSize } = require("../../utils/helpers");
const {
  workspaceFilesystemRoot,
} = require("../../utils/workspaceAgentInstructions");
const {
  expandHome,
  normalizePath,
  isPathWithinAllowedDirectories,
  resolveRelativePathAgainstAllowedDirectories,
  resolveSandboxWorkspaceAlias,
  normalizeLineEndings,
} = require("./pathSecurity.ts");
const {
  FILE_READ_CHUNK_SIZE,
  CONTEXT_RESERVE_RATIO,
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  atomicWrite,
  createUnifiedDiff,
  parseFileWithCollector,
  tailFileRaw,
  headFileRaw,
  applyTextEdits,
  isImageFile,
  getImageMimeType,
  readImageAsAttachment,
} = require("./fileIo.ts");

type FileEdit = import("./fileIo.ts").FileEdit;

/**
 * Manages filesystem operations with security constraints.
 * Ensures all file operations stay within allowed directories.
 */
class FilesystemManager {
  static FILE_READ_CHUNK_SIZE = FILE_READ_CHUNK_SIZE;
  static CONTEXT_RESERVE_RATIO = CONTEXT_RESERVE_RATIO;
  static IMAGE_EXTENSIONS = IMAGE_EXTENSIONS;
  static IMAGE_MIME_TYPES = IMAGE_MIME_TYPES;

  workspaceId: number | null;
  #allowedDirectories: string[] = [];
  #isInitialized = false;

  constructor(workspaceId: number | string | null = null) {
    this.workspaceId = workspaceId ? Number(workspaceId) : null;
  }

  isToolAvailable(): boolean {
    if (process.env.NODE_ENV === "development") return true;
    return process.env.ANYTHING_LLM_RUNTIME === "docker";
  }

  #getDefaultFilesystemRoot(): string {
    if (
      this.workspaceId === null ||
      !Number.isInteger(this.workspaceId) ||
      this.workspaceId < 1
    )
      throw new Error(
        "Authenticated workspace is required for filesystem access."
      );
    return workspaceFilesystemRoot(this.workspaceId);
  }

  forWorkspace(workspaceId: number | string): FilesystemManager {
    const parsed = Number(workspaceId);
    if (!Number.isInteger(parsed) || parsed < 1)
      throw new Error(
        "Authenticated workspace is required for filesystem access."
      );
    return new FilesystemManager(parsed);
  }

  forInvocation(invocation: {
    workspace_id?: number | string;
  }): FilesystemManager {
    return this.forWorkspace(invocation?.workspace_id as number | string);
  }

  async #initializeFilesystem(
    directories: string[] | null = null
  ): Promise<string[]> {
    if (directories && directories.length > 0) {
      this.#allowedDirectories = directories.map((dir) =>
        path.resolve(expandHome(dir))
      );
    } else {
      const defaultRoot = this.#getDefaultFilesystemRoot();
      this.#allowedDirectories = [defaultRoot];
    }

    for (const dir of this.#allowedDirectories) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error: unknown) {
        console.error(
          `Warning: Could not create directory ${dir}: ${(error as Error).message}`
        );
      }
    }

    this.#isInitialized = true;
    return this.#allowedDirectories;
  }

  async #withCollectorFallback(
    filePath: string,
    processContent: (content: string) => string,
    rawFallback: () => Promise<string>
  ): Promise<string> {
    const parseResult = await parseFileWithCollector(filePath);
    if (parseResult.parsed && parseResult.content) {
      return processContent(parseResult.content);
    }
    return rawFallback();
  }

  getAllowedDirectories(): string[] {
    return [...this.#allowedDirectories];
  }

  async ensureInitialized(): Promise<void> {
    if (!this.#isInitialized) await this.#initializeFilesystem();
  }

  async validatePath(requestedPath: string): Promise<string> {
    await this.ensureInitialized();
    const expandedPath = resolveSandboxWorkspaceAlias(
      expandHome(requestedPath),
      this.#allowedDirectories
    );
    const absolute = path.isAbsolute(expandedPath)
      ? path.resolve(expandedPath)
      : resolveRelativePathAgainstAllowedDirectories(
          expandedPath,
          this.#allowedDirectories
        );

    const normalizedRequested = normalizePath(absolute);

    const isAllowed = isPathWithinAllowedDirectories(
      normalizedRequested,
      this.#allowedDirectories
    );
    if (!isAllowed) {
      console.log(
        `[validatePath] Access denied - path outside allowed directories: ${absolute} not in ${this.#allowedDirectories.join(", ")}`
      );
      throw new Error("Access denied - path outside allowed directories.");
    }

    try {
      const realPath = await fs.realpath(absolute);
      const normalizedReal = normalizePath(realPath);
      if (
        !isPathWithinAllowedDirectories(
          normalizedReal,
          this.#allowedDirectories
        )
      ) {
        console.log(
          `[validatePath] Access denied - symlink target outside allowed directories: ${realPath} not in ${this.#allowedDirectories.join(", ")}`
        );
        throw new Error(
          "Access denied - symlink target outside allowed directories."
        );
      }
      return realPath;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const parentDir = path.dirname(absolute);
        try {
          let existingAncestor = parentDir;
          while (true) {
            try {
              await fs.access(existingAncestor);
              break;
            } catch {
              const next = path.dirname(existingAncestor);
              if (next === existingAncestor) throw error;
              existingAncestor = next;
            }
          }
          const realParentPath = await fs.realpath(existingAncestor);
          const normalizedParent = normalizePath(realParentPath);
          if (
            !isPathWithinAllowedDirectories(
              normalizedParent,
              this.#allowedDirectories
            )
          ) {
            console.log(
              `[validatePath] Access denied - parent directory outside allowed directories: ${realParentPath} not in ${this.#allowedDirectories.join(", ")}`
            );
            throw new Error(
              "Access denied - parent directory outside allowed directories."
            );
          }
          return absolute;
        } catch {
          throw new Error(`Parent directory does not exist: ${parentDir}`);
        }
      }
      throw error;
    }
  }

  async getFileStats(filePath: string) {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      sizeFormatted: humanFileSize(stats.size, true, 2),
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      accessed: stats.atime.toISOString(),
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      permissions: stats.mode.toString(8).slice(-3),
    };
  }

  async readFileContent(
    filePath: string,
    encoding: BufferEncoding = "utf-8"
  ): Promise<string> {
    return this.#withCollectorFallback(
      filePath,
      (content) => content,
      () => fs.readFile(filePath, encoding)
    );
  }

  async writeFileContent(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        await atomicWrite(filePath, content);
      } else {
        throw error;
      }
    }
  }

  async deletePath(
    requestedPath: string,
    { recursive = false }: { recursive?: boolean } = {}
  ): Promise<{ path: string; type: "file" | "directory" }> {
    await this.ensureInitialized();
    const expandedPath = resolveSandboxWorkspaceAlias(
      expandHome(requestedPath),
      this.#allowedDirectories
    );
    const lexicalPath = normalizePath(
      path.isAbsolute(expandedPath)
        ? path.resolve(expandedPath)
        : resolveRelativePathAgainstAllowedDirectories(
            expandedPath,
            this.#allowedDirectories
          )
    );
    if (!isPathWithinAllowedDirectories(lexicalPath, this.#allowedDirectories))
      throw new Error("Access denied - path outside allowed directories.");

    // Resolving the real path also proves that any symlink target remains in
    // the workspace. Deletion itself uses the lexical path so deleting a safe
    // symlink removes the link, not its target.
    await this.validatePath(requestedPath);
    const allowedRoots = this.getAllowedDirectories().map((root) =>
      path.resolve(root)
    );
    if (allowedRoots.includes(path.resolve(lexicalPath)))
      throw new Error("The workspace root cannot be deleted.");

    const stats = await fs.lstat(lexicalPath);
    if (stats.isDirectory()) {
      if (recursive)
        await fs.rm(lexicalPath, { recursive: true, force: false });
      else await fs.rmdir(lexicalPath);
      return { path: lexicalPath, type: "directory" };
    }

    await fs.unlink(lexicalPath);
    return { path: lexicalPath, type: "file" };
  }

  async applyFileEdits(
    filePath: string,
    edits: FileEdit[],
    dryRun = false
  ): Promise<string> {
    const content = normalizeLineEndings(await fs.readFile(filePath, "utf-8"));
    const modifiedContent = applyTextEdits(content, edits);
    const diffResult = createUnifiedDiff(content, modifiedContent, filePath);

    let numBackticks = 3;
    while (diffResult.includes("`".repeat(numBackticks))) {
      numBackticks++;
    }
    const formattedDiff = `${"`".repeat(numBackticks)}diff\n${diffResult}${"`".repeat(numBackticks)}\n\n`;

    if (!dryRun) {
      await atomicWrite(filePath, modifiedContent);
    }

    return formattedDiff;
  }

  async tailFile(filePath: string, numLines: number): Promise<string> {
    return this.#withCollectorFallback(
      filePath,
      (content) => {
        const lines = normalizeLineEndings(content).split("\n");
        return lines.slice(-numLines).join("\n");
      },
      () => tailFileRaw(filePath, numLines)
    );
  }

  async headFile(filePath: string, numLines: number): Promise<string> {
    return this.#withCollectorFallback(
      filePath,
      (content) => {
        const lines = normalizeLineEndings(content).split("\n");
        return lines.slice(0, numLines).join("\n");
      },
      () => headFileRaw(filePath, numLines)
    );
  }

  async searchFilesWithGlob(
    rootPath: string,
    pattern: string,
    options: { excludePatterns?: string[] } = {}
  ): Promise<string[]> {
    const minimatch = require("minimatch");
    const { excludePatterns = [] } = options;
    const results: string[] = [];
    const matchOptions = { dot: true, nocase: true };

    const search = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        try {
          await this.validatePath(fullPath);

          const relativePath = path.relative(rootPath, fullPath);
          const shouldExclude = excludePatterns.some(
            (excludePattern) =>
              minimatch(relativePath, excludePattern, matchOptions) ||
              minimatch(entry.name, excludePattern, matchOptions)
          );

          if (shouldExclude) continue;

          const matchesPath = minimatch(relativePath, pattern, matchOptions);
          const matchesName = minimatch(entry.name, pattern, matchOptions);

          if (matchesPath || matchesName) {
            results.push(fullPath);
          }

          if (entry.isDirectory()) {
            await search(fullPath);
          }
        } catch {
          continue;
        }
      }
    };

    await search(rootPath);
    return results;
  }

  isImageFile(filePath: string): boolean {
    return isImageFile(filePath);
  }

  getImageMimeType(filePath: string): string | null {
    return getImageMimeType(filePath);
  }

  async readImageAsAttachment(
    filePath: string
  ): Promise<{ name: string; mime: string; contentString: string } | null> {
    return readImageAsAttachment(filePath);
  }
}

module.exports = { FilesystemManager };
