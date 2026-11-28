const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { load } = require("cheerio");

const execFileAsync = promisify(execFile);

const PUBLIC_FTP_ORIGIN = "https://www.3gpp.org";
const PUBLIC_FTP_BASE = `${PUBLIC_FTP_ORIGIN}/ftp/`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function invalid(publicMessage, status = 400) {
  return Object.assign(new Error(publicMessage), { publicMessage, status });
}

function getMirrorConfig() {
  const localDir = String(process.env.THREE_GPP_LOCAL_MIRROR_DIR || "").trim();
  const httpMirrorRaw = String(
    process.env.THREE_GPP_HTTP_MIRROR_URL || ""
  ).trim();
  const proxyUrl = String(process.env.THREE_GPP_PROXY_URL || "").trim();
  const mirrorInsecure = /^(?:1|true|yes)$/i.test(
    String(process.env.THREE_GPP_HTTP_MIRROR_INSECURE || "").trim()
  );

  let httpMirrorBase = "";
  let httpMirrorOrigin = "";
  if (httpMirrorRaw) {
    try {
      const parsed = new URL(httpMirrorRaw);
      if (
        ["http:", "https:"].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash
      ) {
        httpMirrorOrigin = parsed.origin;
        httpMirrorBase = parsed.href.replace(/\/?$/, "/");
      }
    } catch {
      // Ignore malformed mirror URL
    }
  }

  return {
    localDir,
    httpMirrorBase,
    httpMirrorOrigin,
    mirrorInsecure,
    proxyUrl,
  };
}

function getSourceStatus() {
  const cfg = getMirrorConfig();
  const hasLocalMirror = Boolean(cfg.localDir);
  const hasHttpMirror = Boolean(cfg.httpMirrorBase);
  const sources = [];
  if (hasLocalMirror) sources.push("本地镜像目录");
  if (hasHttpMirror) sources.push("内部 HTTP 镜像");
  sources.push("3GPP 官方目录");
  return {
    hasLocalMirror,
    hasHttpMirror,
    summary: sources.join(" → "),
  };
}

function sanitizeRelPath(relPath) {
  const normalized = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("/");
  for (const part of parts) {
    if (
      !part ||
      part.startsWith(".") ||
      Array.from(part).some((c) => c.charCodeAt(0) < 32)
    ) {
      throw invalid("文档路径包含非法字符。", 400);
    }
  }
  return parts.join("/");
}

function assertAllowedThreeGppUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw invalid("请输入有效的 3GPP 官方或已配置镜像的链接。", 400);
  }
  if (url.username || url.password) {
    throw invalid("链接不能包含用户名或密码。", 400);
  }
  url.hash = "";

  if (url.origin === PUBLIC_FTP_ORIGIN && url.pathname.startsWith("/ftp/")) {
    return { url: url.href, isMirror: false };
  }
  const cfg = getMirrorConfig();
  if (cfg.httpMirrorBase && url.href.startsWith(cfg.httpMirrorBase)) {
    return { url: url.href, isMirror: true };
  }
  throw invalid(
    "仅允许访问 3GPP 官方 FTP（www.3gpp.org/ftp/）或已配置的内部镜像目录。",
    400
  );
}

function buildCurlBaseArgs({
  timeoutSec = 15,
  isMirror = false,
  insecure = false,
  userAgent = USER_AGENT,
} = {}) {
  const cfg = getMirrorConfig();
  const args = [
    "-fsSL",
    "--globoff",
    "--connect-timeout",
    String(Math.min(timeoutSec, 10)),
    "--max-time",
    String(timeoutSec),
    "-A",
    userAgent,
  ];
  if (isMirror) {
    args.push("--noproxy", "*");
    if (cfg.mirrorInsecure || insecure) args.push("-k");
  } else if (cfg.proxyUrl) {
    args.push("--proxy", cfg.proxyUrl);
  }
  return args;
}

function isAbortError(err) {
  return Boolean(
    err &&
    (err.name === "AbortError" ||
      err.code === "ABORT_ERR" ||
      err.message === "request_cancelled")
  );
}

async function execCurl(
  args,
  { signal, maxBuffer = 16 * 1024 * 1024, encoding = "utf8" } = {}
) {
  if (signal?.aborted) {
    throw Object.assign(new Error("request_cancelled"), {
      name: "AbortError",
      status: 499,
    });
  }
  try {
    const { stdout } = await execFileAsync("curl", args, {
      signal,
      maxBuffer,
      encoding,
    });
    return stdout;
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) {
      throw Object.assign(new Error("request_cancelled"), {
        name: "AbortError",
        status: 499,
      });
    }
    throw err;
  }
}

async function curlText(url, opts = {}) {
  const args = [
    ...buildCurlBaseArgs(opts),
    ...(opts.isMirror !== undefined ? ["--max-redirs", "0"] : []),
    url,
  ];
  return execCurl(args, {
    signal: opts.signal,
    maxBuffer: opts.maxBuffer || 8 * 1024 * 1024,
    encoding: "utf8",
  });
}

async function curlBuffer(url, opts = {}) {
  const args = [
    ...buildCurlBaseArgs(opts),
    ...(opts.isMirror !== undefined ? ["--max-redirs", "0"] : []),
    url,
  ];
  return execCurl(args, {
    signal: opts.signal,
    maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
    encoding: "buffer",
  });
}

async function curlHeadOk(url, opts = {}) {
  const args = [
    ...buildCurlBaseArgs({ ...opts, timeoutSec: opts.timeoutSec || 8 }),
    ...(opts.isMirror !== undefined ? ["--max-redirs", "0"] : []),
    "-I",
    url,
  ];
  try {
    const out = await execCurl(args, {
      signal: opts.signal,
      maxBuffer: 256 * 1024,
      encoding: "utf8",
    });
    return { ok: true, headers: out };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { ok: false, error: err };
  }
}

/**
 * Parse an HTML directory index (3GPP FTP table or standard Apache/Nginx listing).
 * Returns [{ name, isDir, url, date, size }].
 */
function parseDirectoryHtml(html, baseUrl) {
  const $ = load(String(html || ""));
  const base = new URL(baseUrl.replace(/\/?$/, "/"));
  const parentPath = base.pathname.toLowerCase();
  const byName = new Map();

  const recordLink = (href, dateText, sizeText) => {
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("?") ||
      href.startsWith("javascript:")
    ) {
      return;
    }
    let resolved;
    try {
      resolved = new URL(href, base);
    } catch {
      return;
    }
    if (resolved.origin !== base.origin) return;
    resolved.search = "";
    resolved.hash = "";
    const lowerPath = resolved.pathname.toLowerCase();
    if (!lowerPath.startsWith(parentPath) || lowerPath === parentPath) return;

    const rest = resolved.pathname.slice(base.pathname.length);
    const trimmedRest = rest.replace(/\/$/, "");
    if (!trimmedRest || trimmedRest.includes("/")) return;

    let name;
    try {
      name = decodeURIComponent(trimmedRest);
    } catch {
      name = trimmedRest;
    }
    if (!name || name.startsWith(".") || /[\\/]/.test(name)) return;

    const isDir =
      resolved.pathname.endsWith("/") || (!name.includes(".") && !sizeText);

    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, {
        name,
        isDir,
        url: isDir ? resolved.href.replace(/\/?$/, "/") : resolved.href,
        date: dateText || undefined,
        size: sizeText || undefined,
      });
    } else {
      if (dateText && !existing.date) existing.date = dateText;
      if (sizeText && !existing.size) existing.size = sizeText;
      if (resolved.pathname.endsWith("/")) existing.isDir = true;
    }
  };

  $("tr").each((_, row) => {
    const link = $(row).find("a.file[href], a[href]").first();
    const href = link.attr("href");
    if (!href) return;
    const cells = $(row)
      .children("td")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();
    const dateCell = cells.find((c) => /^\d{4}[/-]\d{2}[/-]\d{2}/.test(c));
    const sizeCell = cells.find((c) => /[\d.,]+\s*(?:KB|MB|GB|B)$/i.test(c));
    recordLink(href, dateCell ? dateCell.split(" ")[0] : undefined, sizeCell);
  });

  if (!byName.size) {
    $("a[href]").each((_, el) => {
      recordLink($(el).attr("href"));
    });
  }

  return [...byName.values()];
}

const dirListCache = new Map();
const DIR_CACHE_TTL_MS = 10 * 60 * 1000;

function clearDirCacheForTest() {
  dirListCache.clear();
}

function getActiveSources() {
  const cfg = getMirrorConfig();
  const list = [];
  if (cfg.localDir) {
    list.push({ id: "local-mirror", label: "本地镜像", root: cfg.localDir });
  }
  if (cfg.httpMirrorBase) {
    list.push({
      id: "http-mirror",
      label: "内部 HTTP 镜像",
      baseUrl: cfg.httpMirrorBase,
      isMirror: true,
    });
  }
  list.push({
    id: "public",
    label: "3GPP 官方",
    baseUrl: PUBLIC_FTP_BASE,
    isMirror: false,
  });
  return list;
}

async function localMirrorPath(source, relPath) {
  const root = await fs.realpath(source.root);
  const file = await fs.realpath(path.join(root, sanitizeRelPath(relPath)));
  if (file !== root && !file.startsWith(root + path.sep))
    throw invalid("文档超出镜像目录。");
  return file;
}

async function localFileForUrl(url) {
  const source = getActiveSources().find((s) => s.id === "local-mirror");
  if (!source || !url.startsWith(PUBLIC_FTP_BASE)) return null;
  const relPath = sanitizeRelPath(
    decodeURIComponent(new URL(url).pathname.slice(5))
  );
  if (
    !/^(?:tsg_(?:sa|ct|ran)|Meetings_3GPP_SYNC|Specs|IETF-mirror|workshop)\//i.test(
      relPath
    )
  )
    return null;
  return checkFileInSource(source, relPath);
}

async function downloadDocument(
  url,
  { signal, maxBytes = 64 * 1024 * 1024 } = {}
) {
  const safe = assertAllowedThreeGppUrl(url);
  const local = await localFileForUrl(safe.url);
  if (local) {
    if (local.size > maxBytes) throw invalid("文件超过单次下载上限。", 413);
    return fs.readFile(local.localPath, { signal });
  }
  return curlBuffer(safe.url, {
    signal,
    isMirror: safe.isMirror,
    maxBuffer: maxBytes,
    timeoutSec: 60,
  });
}

function fileUrl(base, relPath) {
  return base + relPath.split("/").map(encodeURIComponent).join("/");
}

async function listFromSource(
  source,
  relPath,
  { signal, refresh = false } = {}
) {
  const cleanRel = sanitizeRelPath(relPath);
  const cacheKey = `${source.root || source.baseUrl}:${cleanRel}`;
  if (!refresh) {
    const hit = dirListCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) {
      return hit.entries;
    }
  }

  let entries = [];
  if (source.id === "local-mirror") {
    const fullDir = await localMirrorPath(source, cleanRel);
    const dirents = await fs.readdir(fullDir, { withFileTypes: true });
    entries = dirents
      .filter((d) => !d.name.startsWith(".") && !d.isSymbolicLink())
      .map((d) => ({
        name: d.name,
        isDir: d.isDirectory(),
        localPath: path.join(fullDir, d.name),
        relPath: cleanRel ? `${cleanRel}/${d.name}` : d.name,
        url:
          fileUrl(
            PUBLIC_FTP_BASE,
            [cleanRel, d.name].filter(Boolean).join("/")
          ) + (d.isDirectory() ? "/" : ""),
      }));
  } else {
    const url = fileUrl(source.baseUrl, cleanRel) + (cleanRel ? "/" : "");
    const html = await curlText(url, {
      signal,
      isMirror: source.isMirror,
      timeoutSec: source.isMirror ? 5 : 15,
    });
    entries = parseDirectoryHtml(html, url).map((item) => ({
      ...item,
      relPath: cleanRel ? `${cleanRel}/${item.name}` : item.name,
    }));
  }

  dirListCache.set(cacheKey, {
    entries,
    expires: Date.now() + DIR_CACHE_TTL_MS,
  });
  while (dirListCache.size > 256) {
    dirListCache.delete(dirListCache.keys().next().value);
  }
  return entries;
}

async function checkFileInSource(source, relPath, { signal } = {}) {
  const cleanRel = sanitizeRelPath(relPath);
  if (source.id === "local-mirror") {
    try {
      const full = await localMirrorPath(source, cleanRel);
      const st = await fs.stat(full);
      if (!st.isFile()) return null;
      return {
        sourceId: source.id,
        sourceLabel: source.label,
        relPath: cleanRel,
        localPath: full,
        size: st.size,
        url: fileUrl(PUBLIC_FTP_BASE, cleanRel),
      };
    } catch {
      return null;
    }
  }
  const url = fileUrl(source.baseUrl, cleanRel);
  const head = await curlHeadOk(url, {
    signal,
    isMirror: source.isMirror,
    timeoutSec: source.isMirror ? 4 : 8,
  });
  if (!head.ok) return null;
  const lenMatch = String(head.headers || "").match(/content-length:\s*(\d+)/i);
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    relPath: cleanRel,
    url,
    size: lenMatch ? Number(lenMatch[1]) : undefined,
  };
}

module.exports = {
  PUBLIC_FTP_ORIGIN,
  PUBLIC_FTP_BASE,
  USER_AGENT,
  getMirrorConfig,
  getSourceStatus,
  sanitizeRelPath,
  assertAllowedThreeGppUrl,
  buildCurlBaseArgs,
  isAbortError,
  curlText,
  curlBuffer,
  curlHeadOk,
  parseDirectoryHtml,
  getActiveSources,
  listFromSource,
  checkFileInSource,
  localFileForUrl,
  downloadDocument,
  clearDirCacheForTest,
};
