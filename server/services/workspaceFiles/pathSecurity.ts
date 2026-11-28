const path = require("path");
const os = require("os");

const SANDBOX_WORKSPACE_ALIAS = "/workspace";

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function normalizePath(p: string): string {
  const cleaned = p.trim().replace(/^["']|["']$/g, "");
  if (cleaned.startsWith("/"))
    return cleaned.replace(/\/+/g, "/").replace(/(?<!^)\/$/, "");
  return path.normalize(cleaned);
}

function normalizeAndValidatePath(p: unknown): string | null {
  if (typeof p !== "string" || !p || p.includes("\x00")) return null;
  try {
    const normalized = path.resolve(path.normalize(p));
    return path.isAbsolute(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function isPathWithinAllowedDirectories(
  absolutePath: string,
  allowedDirs: string[]
): boolean {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) return false;

  const normalizedPath = normalizeAndValidatePath(absolutePath);
  if (!normalizedPath) return false;

  return allowedDirs.some((dir) => {
    const normalizedDir = normalizeAndValidatePath(dir);
    if (!normalizedDir) return false;

    if (normalizedPath === normalizedDir) return true;
    return normalizedPath.startsWith(normalizedDir + path.sep);
  });
}

function resolveRelativePathAgainstAllowedDirectories(
  relativePath: string,
  allowedDirs: string[]
): string {
  if (allowedDirs.length === 0) {
    return path.resolve(process.cwd(), relativePath);
  }

  for (const allowedDir of allowedDirs) {
    const candidate = path.resolve(allowedDir, relativePath);
    const normalizedCandidate = normalizePath(candidate);

    if (isPathWithinAllowedDirectories(normalizedCandidate, allowedDirs)) {
      return candidate;
    }
  }

  return path.resolve(allowedDirs[0], relativePath);
}

function resolveSandboxWorkspaceAlias(
  requestedPath: string,
  allowedDirs: string[]
): string {
  if (requestedPath === SANDBOX_WORKSPACE_ALIAS) return allowedDirs[0];
  if (!requestedPath.startsWith(`${SANDBOX_WORKSPACE_ALIAS}/`))
    return requestedPath;
  return path.join(
    allowedDirs[0],
    requestedPath.slice(SANDBOX_WORKSPACE_ALIAS.length + 1)
  );
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

module.exports = {
  SANDBOX_WORKSPACE_ALIAS,
  expandHome,
  normalizePath,
  normalizeAndValidatePath,
  isPathWithinAllowedDirectories,
  resolveRelativePathAgainstAllowedDirectories,
  resolveSandboxWorkspaceAlias,
  normalizeLineEndings,
};
