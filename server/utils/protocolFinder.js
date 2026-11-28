const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { load } = require("cheerio");
const exec = require("node:util").promisify(
  require("node:child_process").execFile
);
const pdfTools = require("./protocolFinderPdf");
const {
  parseSpecNumber,
  matchSpecFilename,
  RELEASE_LADDER,
} = require("./threeGppClassifier");
const {
  PUBLIC_FTP_BASE,
  getActiveSources,
  listFromSource,
  getMirrorConfig,
} = require("./threeGppSources");

const USER_AGENT = "Mozilla/5.0 AnythingLLM-Agent/1.0";

const titles = {
  "38.413": "NG Application Protocol (NGAP)",
  "29.501": "Principles and Guidelines for Services Definition",
  "38.901": "Study on channel model for frequencies from 0.5 to 100 GHz",
  "38.523-3": "UE conformance specification · Protocol test suites",
  "23.501": "System architecture for the 5G System (5GS)",
  "23.502": "Procedures for the 5G System (5GS)",
};

let officialKiCache = null;

async function loadOfficialKiMap() {
  if (officialKiCache) return officialKiCache;
  const map = new Map();
  try {
    const file = path.resolve(
      __dirname,
      "../../agent-config/references/3gpp-official-ki.json"
    );
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    for (const study of data.studies || []) {
      if (!study?.spec) continue;
      const byNumber = new Map();
      for (const entry of study.entries || []) {
        if (entry?.number) byNumber.set(String(entry.number), entry);
      }
      map.set(study.spec, {
        group: study.group || "",
        project: study.project || "",
        byNumber,
      });
    }
  } catch {
    // Optional enrichment file; ignore if unavailable.
  }
  officialKiCache = map;
  return map;
}

function invalid(publicMessage, status = 400) {
  return Object.assign(new Error(publicMessage), { publicMessage, status });
}

function compareVersionsDesc(a, b) {
  const pa = String(a || "")
    .split(".")
    .map(Number);
  const pb = String(b || "")
    .split(".")
    .map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseQuery(q, v) {
  if (
    typeof q !== "string" ||
    q.length > 100 ||
    (v !== undefined &&
      (typeof v !== "string" || !/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(v)))
  )
    throw invalid(
      "请输入有效的规范编号或文件名，例如 38.413-i60 或 23.801-01。"
    );

  const parsed = parseSpecNumber(q);
  if (!parsed)
    throw invalid(
      "请输入有效的规范编号或文件名，例如 38.413-i60 或 23.801-01。"
    );

  const { kind, series, num, requestedVersion } = parsed;
  const numParts = num.split("-");
  const item = numParts[0];
  const rawPart = numParts.length > 1 ? numParts.slice(1).join("-") : "";
  const isSinglePart = numParts.length === 2;
  const partNumeric = isSinglePart ? String(Number(rawPart)) : rawPart;
  const partPadded = isSinglePart ? rawPart.padStart(2, "0") : rawPart;
  const id = series + "." + num;
  const etsiId = series + "." + item + (partNumeric ? "-" + partNumeric : "");
  const number = "1" + series + item;
  const key = number + (isSinglePart ? partPadded : "");
  const base = Math.floor(Number(number) / 100) * 100;

  const archiveIds = isSinglePart
    ? [
        ...new Set([
          `${series}.${item}-${rawPart}`,
          `${series}.${item}-${partPadded}`,
          `${series}.${item}-${partNumeric}`,
        ]),
      ]
    : [`${series}.${num}`];

  return {
    kind,
    series,
    item,
    num,
    rawPart,
    partNumeric,
    partPadded,
    id,
    etsiId,
    number,
    key,
    base,
    requested: requestedVersion,
    ver: parsed.ver,
    archiveIds,
    parsedSpec: parsed,
  };
}

async function directory(url, signal) {
  return (
    await exec(
      "curl",
      [
        "-fsS",
        "--max-time",
        "15",
        "-A",
        USER_AGENT,
        ...(getMirrorConfig().proxyUrl
          ? ["--proxy", getMirrorConfig().proxyUrl]
          : []),
        url,
      ],
      {
        maxBuffer: 8 * 1024 * 1024,
        signal,
      }
    )
  ).stdout;
}

function isHttpMissing(error) {
  return Boolean(
    error && error.code === 22 && /(?:403|404)/.test(String(error.stderr || ""))
  );
}

function formatArchiveSize(rawText) {
  const clean = String(rawText || "").trim();
  const kbMatch = clean.match(/^([\d.,]+)\s*KB$/i);
  if (!kbMatch) return clean || undefined;
  const kb = Number(kbMatch[1].replace(",", "."));
  if (!Number.isFinite(kb) || kb <= 0) return clean;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb)} KB`;
}

function parseThreeGppArchiveHtml(html, baseUrl, spec) {
  const $ = load(html);
  const partPattern = spec.rawPart
    ? spec.rawPart.includes("-")
      ? `-${spec.rawPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
      : `-0?${spec.partNumeric}`
    : "";
  const pattern = new RegExp(
    `^${spec.series}${spec.item}${partPattern}-([0-9a-z]{3})\\.zip$`,
    "i"
  );
  const byVersion = new Map();

  $("tr").each((_, row) => {
    const link = $(row).find("a.file[href], a[href]").first();
    const href = link.attr("href");
    if (!href) return;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (
      url.origin !== "https://www.3gpp.org" ||
      !url.pathname.startsWith("/ftp/Specs/archive/")
    )
      return;
    const filename = path.posix.basename(decodeURIComponent(url.pathname));
    const match = filename.match(pattern);
    if (!match) return;

    const version = [...match[1].toLowerCase()]
      .map((c) => parseInt(c, 36))
      .join(".");
    const cells = $(row)
      .children("td")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();
    const dateCell = cells.find((c) => /^\d{4}\/\d{2}\/\d{2}/.test(c));
    const sizeCell = cells.find((c) => /[\d.,]+\s*(?:KB|MB|B)$/i.test(c));
    byVersion.set(version, {
      version,
      date: dateCell ? dateCell.split(" ")[0] : undefined,
      source: "3gpp",
      zipName: filename,
      zipUrl: url.href,
      zipSize: formatArchiveSize(sizeCell),
    });
  });

  // Fallback for lightweight HTML fixtures without <table> markup.
  if (!byVersion.size) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      let url;
      try {
        url = new URL(href, baseUrl);
      } catch {
        return;
      }
      if (
        url.origin !== "https://www.3gpp.org" ||
        !url.pathname.startsWith("/ftp/Specs/archive/")
      )
        return;
      const filename = path.posix.basename(decodeURIComponent(url.pathname));
      const match = filename.match(pattern);
      if (!match) return;
      const version = [...match[1].toLowerCase()]
        .map((c) => parseInt(c, 36))
        .join(".");
      byVersion.set(version, {
        version,
        source: "3gpp",
        zipName: filename,
        zipUrl: url.href,
      });
    });
  }

  return [...byVersion.values()].sort((a, b) =>
    compareVersionsDesc(a.version, b.version)
  );
}

const SERIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadSeriesSubSpecs(spec, refresh, cache, kiMap, signal) {
  if (spec.rawPart) return [];
  const seriesDir = `https://www.3gpp.org/ftp/Specs/archive/${spec.series}_series/`;
  const file = `3gpp-series-${spec.series}.json`;
  let seriesIndex = await cache.read(file);

  const isStale =
    !seriesIndex ||
    refresh === "1" ||
    !seriesIndex.checked ||
    Date.now() - Date.parse(seriesIndex.checked) > SERIES_CACHE_TTL_MS;

  if (isStale) {
    try {
      const html = await directory(seriesDir, signal);
      const $ = load(html);
      const dirs = new Set();
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        let url;
        try {
          url = new URL(href, seriesDir);
        } catch {
          return;
        }
        if (
          url.origin !== "https://www.3gpp.org" ||
          !url.pathname.startsWith(`/ftp/Specs/archive/${spec.series}_series/`)
        )
          return;
        const name = path.posix.basename(
          decodeURIComponent(url.pathname).replace(/\/$/, "")
        );
        if (/^\d{2}\.\d{3}-\d{1,2}$/.test(name)) dirs.add(name);
      });
      seriesIndex = {
        dirs: [...dirs].sort((a, b) =>
          a.localeCompare(b, "en", { numeric: true })
        ),
        checked: new Date().toISOString(),
      };
      await cache.save(file, seriesIndex);
    } catch {
      signal?.throwIfAborted();
      if (!seriesIndex) {
        await cache.save(file, {
          dirs: [],
          checked: new Date().toISOString(),
        });
        return [];
      }
    }
  }

  const prefix = `${spec.series}.${spec.item}-`;
  const matched = (seriesIndex?.dirs || []).filter((d) => d.startsWith(prefix));
  const defaultType = guessSpecType(spec);
  return matched.map((id) => {
    const study = kiMap.get(id);
    return {
      id,
      type: defaultType,
      group: study?.group || undefined,
      title: titles[id] || study?.project || undefined,
      kiCount: study?.byNumber?.size || undefined,
    };
  });
}

function guessSpecType(spec) {
  if (spec.kind) return spec.kind;
  return Number(spec.item) >= 700 ? "TR" : "TS";
}

function buildMemberLabel(memberName, study) {
  const base = path.posix.basename(memberName);
  if (/cover[_-]?s0?5/i.test(base)) return "封面与第 1～5 章（含 KI 定义）";
  if (/_s0?6_00(?:\.|$)/i.test(base)) return "第 6 章总览";
  if (/_s0?7_s0?9(?:\.|$)/i.test(base)) return "第 7～9 章";
  if (/_sAnnexes(?:\.|$)/i.test(base)) return "附录 (Annexes)";

  const kiMatches = [...base.matchAll(/_s0?6_(\d{2})(?=_|\.|$)/gi)];
  if (kiMatches.length && study) {
    const parts = kiMatches.map((m) => {
      const num = String(Number(m[1]));
      const info = study.byNumber.get(num);
      if (!info) return `KI#${num}`;
      return `KI#${num} ${info.title}`;
    });
    return parts.join(" / ");
  }

  if (/(?:^|[_-])clean(?=\.|[_-]|$)/i.test(base)) return "纯净版（无修订标记）";
  if (/(?:^|[_-])rm(?=\.|[_-]|$)/i.test(base))
    return "修订标记版（含修改痕迹）";
  return undefined;
}

function memberSortScore(item) {
  if (!item.isWord) return 3;
  if (item.isRevisionMarked) return 2;
  return 1;
}

async function createCacheHelpers() {
  const cache = pdfTools.storageRoot();
  await fs.mkdir(cache, { recursive: true });
  async function read(name) {
    try {
      return JSON.parse(await fs.readFile(path.join(cache, name), "utf8"));
    } catch {
      return null;
    }
  }
  async function save(name, value) {
    const file = path.join(cache, name);
    const tmp = file + "." + randomUUID();
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, file);
  }
  return { read, save };
}

async function loadEtsiIndex(spec, refresh, cache, signal) {
  if (spec.rawPart.includes("-")) return { found: false };
  const types = spec.kind
    ? [spec.kind]
    : Number(spec.item) >= 700
      ? ["TR", "TS"]
      : ["TS", "TR"];

  let lastError = null;

  for (const type of types) {
    const dir =
      "https://www.etsi.org/deliver/etsi_" +
      type.toLowerCase() +
      "/" +
      spec.base +
      "_" +
      (spec.base + 99) +
      "/" +
      spec.key +
      "/";
    const file = type + spec.key + ".json";
    let index = await cache.read(file);
    let warning = "";

    if (index?.missing && refresh !== "1") continue;

    if (!index || index.missing || refresh === "1") {
      try {
        const entries = [];
        for (const row of (await directory(dir, signal)).split(
          /<br\s*\/?\s*>/i
        )) {
          const folder = row.match(/>(\d+\.\d+\.\d+_\d+)\s*<\/a>/i)?.[1];
          if (folder) {
            entries.push({
              folder,
              version: folder.split("_")[0].split(".").map(Number).join("."),
              date: row.match(/\d+\/\d+\/\d{4}/)?.[0],
              source: "etsi",
            });
          }
        }
        if (!entries.length) {
          // Directory exists but returned no ETSI version folders.
          continue;
        }
        entries.sort((a, b) => compareVersionsDesc(a.version, b.version));
        index = { entries, checked: new Date().toISOString() };
        await cache.save(file, index);
      } catch (error) {
        signal?.throwIfAborted();
        if (!index && isHttpMissing(error)) {
          await cache.save(file, {
            entries: [],
            missing: true,
            checked: new Date().toISOString(),
          });
          continue;
        }
        if (!index || index.missing) {
          lastError = error;
          continue;
        }
        warning = "刷新失败，当前显示已保存的目录。";
      }
    }

    if (index?.entries?.length) {
      return {
        found: true,
        type,
        dir,
        entries: index.entries.map((e) => ({ ...e, source: "etsi" })),
        checked: index.checked,
        warning,
      };
    }
  }

  return { found: false, error: lastError };
}

async function loadThreeGppArchiveIndex(
  spec,
  refresh,
  cache,
  signal,
  version,
  release
) {
  let lastError = null;

  for (const archiveId of spec.archiveIds) {
    const archiveDir = `https://www.3gpp.org/ftp/Specs/archive/${spec.series}_series/${archiveId}/`;
    for (const source of getActiveSources().filter((s) => s.id !== "public")) {
      const rel = `Specs/archive/${spec.series}_series/${archiveId}`;
      try {
        const files = await listFromSource(source, rel, {
          refresh: refresh === "1",
          signal,
        });
        const entries = files.flatMap((item) => {
          const match = item.name.match(/^(.*)-([a-z0-9]{3})\.zip$/i);
          if (!match || match[1] !== archiveId.replace(".", "") || item.isDir)
            return [];
          return [
            {
              source: "3gpp",
              mirrored: true,
              version: [...match[2]].map((c) => parseInt(c, 36)).join("."),
              zipName: item.name,
              zipUrl: item.url,
              zipSize: item.size,
              date: item.date,
            },
          ];
        });
        const wanted = version || spec.requested;
        const wantedRelease = String(release || "").replace(/^rel-?/i, "");
        if (
          entries.some((e) =>
            wanted
              ? e.version === wanted
              : !wantedRelease || e.version.split(".")[0] === wantedRelease
          )
        )
          return {
            found: true,
            entries,
            archiveId,
            archiveDir,
            checked: new Date().toISOString(),
          };
      } catch {
        signal?.throwIfAborted();
        /* Continue with the next source. */
      }
    }
    const file = `3gpp-${archiveId}.json`;
    let index = await cache.read(file);
    let warning = "";

    if (index?.missing && refresh !== "1") continue;

    if (!index || index.missing || refresh === "1") {
      try {
        const html = await directory(archiveDir, signal);
        const entries = parseThreeGppArchiveHtml(html, archiveDir, spec);
        if (!entries.length) {
          await cache.save(file, {
            entries: [],
            missing: true,
            archiveId,
            archiveDir,
            checked: new Date().toISOString(),
          });
          continue;
        }
        index = {
          entries,
          archiveId,
          archiveDir,
          checked: new Date().toISOString(),
        };
        await cache.save(file, index);
      } catch (error) {
        signal?.throwIfAborted();
        if (!index && isHttpMissing(error)) {
          await cache.save(file, {
            entries: [],
            missing: true,
            archiveId,
            archiveDir,
            checked: new Date().toISOString(),
          });
          continue;
        }
        if (!index || index.missing) {
          lastError = error;
          continue;
        }
        warning = "3GPP 归档目录刷新失败，当前显示已保存的目录。";
      }
    }

    if (index?.entries?.length) {
      return {
        found: true,
        archiveId: index.archiveId || archiveId,
        archiveDir: index.archiveDir || archiveDir,
        entries: index.entries,
        checked: index.checked,
        warning,
      };
    }
  }

  return { found: false, error: lastError };
}

function mergeEntries(etsiEntries, archiveEntries) {
  const byVersion = new Map();
  for (const e of etsiEntries || []) {
    byVersion.set(e.version, { ...e, source: "etsi" });
  }
  for (const a of archiveEntries || []) {
    const existing = byVersion.get(a.version);
    if (existing) {
      existing.zipUrl = a.zipUrl;
      existing.mirrored = a.mirrored;
      existing.zipName = a.zipName;
      if (a.zipSize) existing.zipSize = a.zipSize;
    } else {
      byVersion.set(a.version, { ...a, source: "3gpp" });
    }
  }
  return [...byVersion.values()].sort((a, b) =>
    compareVersionsDesc(a.version, b.version)
  );
}

async function loadZipManifest(archiveId, entry, refresh, cache) {
  const cacheFile = `3gpp-zip-${archiveId}-${entry.zipName}.json`;
  let manifest = refresh === "1" ? null : await cache.read(cacheFile);
  if (!manifest || manifest.zipUrl !== entry.zipUrl || entry.mirrored) {
    const inspected = await pdfTools.inspectRemoteZip(entry.zipUrl, {
      allowAnyFtp: !!entry.mirrored,
    });
    manifest = {
      archiveId,
      zipName: entry.zipName,
      zipUrl: entry.zipUrl,
      totalSize: inspected.totalSize,
      acceptRanges: inspected.acceptRanges,
      entries: inspected.entries,
      checked: new Date().toISOString(),
    };
    if (!entry.mirrored) await cache.save(cacheFile, manifest);
  }
  return manifest;
}

async function decorateZipMembers(archiveId, manifest) {
  const { wordMaxBytes } = pdfTools.getConfig();
  const kiMap = await loadOfficialKiMap();
  const study = kiMap.get(archiveId) || null;
  const maxMb = Math.round(wordMaxBytes / 1024 / 1024);

  const decorated = [];
  for (const raw of manifest.entries || []) {
    const isWord = /\.(docx?|rtf)$/i.test(raw.name);
    const base = path.posix.basename(raw.name);
    const isRevisionMarked = /(?:^|[_-])rm(?=\.|[_-]|$)/i.test(base);
    const tooLarge = isWord && raw.uncompressedSize > wordMaxBytes;
    const methodSupported = raw.method === 0 || raw.method === 8;
    const convertible = isWord && !tooLarge && methodSupported;

    let reason;
    if (!isWord) reason = "非 Word 文档，请直接下载 3GPP 原包查看。";
    else if (tooLarge)
      reason = `文件超过 ${maxMb} MB 转换上限，请直接下载 3GPP 原包。`;
    else if (!methodSupported)
      reason = "暂不支持该压缩格式，请直接下载 3GPP 原包。";

    const hash = pdfTools.pdfCacheKey(archiveId, manifest.zipName, raw.name);
    const filename = pdfTools.displayPdfFilename(raw.name);
    const view = convertible
      ? await pdfTools.getJobView(hash, filename)
      : { status: "unsupported", cached: false };

    decorated.push({
      name: raw.name,
      label: buildMemberLabel(raw.name, study),
      size: raw.uncompressedSize,
      compressedSize: raw.compressedSize,
      isWord,
      isRevisionMarked,
      convertible,
      reason,
      hash,
      filename,
      status: view.status,
      cached: Boolean(view.cached),
      pdfPath: view.pdfPath,
      pdfSize: view.size,
      progress: view.progress,
      error: view.error,
    });
  }

  decorated.sort((a, b) => {
    const scoreDiff = memberSortScore(a) - memberSortScore(b);
    if (scoreDiff !== 0) return scoreDiff;
    return a.name.localeCompare(b.name, "en", { numeric: true });
  });

  return decorated;
}

async function loadThreeGppLatestFallback(spec, rel, signal) {
  const parsedRel = Number(
    String(rel || "")
      .replace(/^rel-?/i, "")
      .trim()
  );
  const candidates = [];
  if (Number.isInteger(parsedRel) && parsedRel > 0 && parsedRel <= 30) {
    if (parsedRel <= 2)
      candidates.push(`${PUBLIC_FTP_BASE}Specs/latest-drafts/`);
    candidates.push(
      `${PUBLIC_FTP_BASE}Specs/latest/Rel-${parsedRel}/${spec.series}_series/`
    );
  } else {
    candidates.push(`${PUBLIC_FTP_BASE}Specs/latest-drafts/`);
    for (const r of RELEASE_LADDER) {
      candidates.push(
        `${PUBLIC_FTP_BASE}Specs/latest/Rel-${r}/${spec.series}_series/`
      );
    }
  }

  for (const source of getActiveSources()) {
    for (const dirUrl of candidates) {
      try {
        const items = (
          await listFromSource(source, dirUrl.slice(PUBLIC_FTP_BASE.length), {
            signal,
          })
        ).filter((x) => !x.isDir);
        const matchedName = matchSpecFilename(
          items.map((x) => x.name),
          spec.parsedSpec,
          { strictWeb: true }
        );
        if (!matchedName) continue;
        const item = items.find((x) => x.name === matchedName);
        if (!item) continue;
        const verMatch = matchedName.match(/-([0-9a-z]{3})\.(?:zip|rar)$/i);
        const version = verMatch
          ? [...verMatch[1].toLowerCase()].map((c) => parseInt(c, 36)).join(".")
          : "0.0.0";
        return {
          found: true,
          archiveId: spec.id,
          archiveDir: dirUrl,
          entries: [
            {
              version,
              date: item.date,
              source: "3gpp",
              mirrored: source.id !== "public",
              zipName: item.name,
              zipUrl: item.url,
              zipSize: formatArchiveSize(item.size),
            },
          ],
          checked: new Date().toISOString(),
          warning: "",
        };
      } catch {
        signal?.throwIfAborted();
        // Try next directory in ladder
      }
    }
  }
  return { found: false };
}

async function resolveSpecIndexes({ q, v, rel, refresh, signal }) {
  const spec = parseQuery(q, v);
  const cache = await createCacheHelpers();
  const kiMap = await loadOfficialKiMap();
  const [etsi, archiveRaw, subSpecs] = await Promise.all([
    loadEtsiIndex(spec, refresh, cache, signal),
    loadThreeGppArchiveIndex(spec, refresh, cache, signal, v, rel),
    v === undefined
      ? loadSeriesSubSpecs(spec, refresh, cache, kiMap, signal)
      : [],
  ]);

  let archive = archiveRaw;
  const targetVersion = v || spec.requested;
  const targetRelease = String(rel || "").replace(/^rel-?/i, "");
  const indexed = [...(etsi.entries || []), ...(archive.entries || [])];
  if (
    !indexed.length ||
    (targetVersion && !indexed.some((e) => e.version === targetVersion)) ||
    (targetRelease &&
      !indexed.some((e) => e.version.split(".")[0] === targetRelease))
  ) {
    const versionCode =
      targetVersion &&
      targetVersion
        .split(".")
        .map((n) => Number(n).toString(36))
        .join("");
    const target = versionCode
      ? { ...spec, parsedSpec: { ...spec.parsedSpec, ver: "-" + versionCode } }
      : spec;
    const fallback = await loadThreeGppLatestFallback(
      target,
      rel || targetVersion?.split(".")[0],
      signal
    );
    if (fallback.found)
      archive = {
        ...fallback,
        entries: [...(archive.entries || []), ...fallback.entries],
      };
  }

  if (!etsi.found && !archive.found) {
    if (subSpecs.length > 0 && v === undefined) {
      return {
        spec,
        cache,
        type: guessSpecType(spec),
        id: spec.id,
        title: titles[spec.id],
        dir: undefined,
        archiveDir: `https://www.3gpp.org/ftp/Specs/archive/${spec.series}_series/`,
        sources: { etsi: false, threeGpp: true },
        entries: [],
        subSpecs,
        checked: new Date().toISOString(),
        requested: spec.requested,
        warning: "",
      };
    }
    if (etsi.error && !isHttpMissing(etsi.error)) throw etsi.error;
    if (archive.error && !isHttpMissing(archive.error)) throw archive.error;
    throw invalid("ETSI 和 3GPP 官方归档中均未找到该规范。", 404);
  }

  const entries = mergeEntries(
    etsi.found ? etsi.entries : [],
    archive.found ? archive.entries : []
  );
  const canonicalId = archive.found
    ? archive.archiveId
    : etsi.found
      ? spec.etsiId
      : spec.id;
  const type = etsi.found ? etsi.type : guessSpecType(spec);
  const checked =
    [etsi.checked, archive.checked].filter(Boolean).sort().pop() ||
    new Date().toISOString();
  const warnings = [etsi.warning, archive.warning].filter(Boolean);
  const study = kiMap.get(canonicalId);

  let requested = spec.requested;
  if (!requested && rel !== undefined && String(rel).trim()) {
    const cleanRel = String(rel)
      .trim()
      .replace(/^rel-?/i, "");
    const relNum = Number(cleanRel);
    if (Number.isInteger(relNum) && relNum >= 0 && relNum <= 30) {
      const hit = entries.find((e) => {
        const major = Number(String(e.version || "").split(".")[0]);
        return relNum <= 2 ? major <= 2 : major === relNum;
      });
      if (hit) requested = hit.version;
      else
        warnings.push(
          `该规范暂无 Release ${relNum} 版本，已显示最新可用版本。`
        );
    }
  }

  return {
    spec,
    cache,
    type,
    id: canonicalId,
    title: titles[canonicalId] || titles[spec.etsiId] || study?.project,
    dir: etsi.found ? etsi.dir : undefined,
    archiveDir: archive.found ? archive.archiveDir : undefined,
    sources: { etsi: etsi.found, threeGpp: archive.found },
    entries,
    subSpecs,
    checked,
    requested,
    warning: warnings.join(" "),
  };
}

async function resolveProtocol({ q, v, rel, refresh, signal }) {
  const ctx = await resolveSpecIndexes({ q, v, rel, refresh, signal });

  if (v !== undefined) {
    const entry = ctx.entries.find((e) => e.version === v);
    if (!entry) throw invalid("目录中没有这个版本。", 404);

    if (entry.source === "etsi" && ctx.dir) {
      const name = ctx.type + ctx.spec.key + "-" + entry.folder + ".json";
      let pdf = await ctx.cache.read(name);
      if (!pdf) {
        const page = await directory(ctx.dir + entry.folder + "/", signal);
        const filename = page.match(/href="[^"]*\/([a-z0-9_-]+\.pdf)"/i)?.[1];
        if (!filename) throw invalid("此版本目录中没有 PDF。", 404);
        pdf = ctx.dir + entry.folder + "/" + filename;
        await ctx.cache.save(name, pdf);
      }
      return {
        source: "etsi",
        pdf,
        zipUrl: entry.zipUrl,
      };
    }

    const manifest = await loadZipManifest(ctx.id, entry, refresh, ctx.cache);
    const members = await decorateZipMembers(ctx.id, manifest);
    const { wordMaxBytes } = pdfTools.getConfig();
    return {
      source: "3gpp",
      zipUrl: entry.zipUrl,
      zipName: entry.zipName,
      zipSize: entry.zipSize,
      totalSize: manifest.totalSize,
      wordMaxBytes,
      members,
    };
  }

  return {
    type: ctx.type,
    id: ctx.id,
    title: ctx.title,
    dir: ctx.dir,
    archiveDir: ctx.archiveDir,
    sources: ctx.sources,
    subSpecs: ctx.subSpecs?.length ? ctx.subSpecs : undefined,
    index: { entries: ctx.entries, checked: ctx.checked },
    requested: ctx.requested,
    warning: ctx.warning,
  };
}

async function resolveMemberTarget({ q, v, member }) {
  if (typeof member !== "string" || !member.trim() || member.length > 260)
    throw invalid("请指定要转换的文档名称。", 400);
  const ctx = await resolveSpecIndexes({ q, v, refresh: "0" });
  const entry = ctx.entries.find((e) => e.version === v);
  if (!entry) throw invalid("目录中没有这个版本。", 404);
  if (entry.source !== "3gpp" || !entry.zipUrl)
    throw invalid("该版本已有 ETSI 官方 PDF，无需转换。", 400);

  const manifest = await loadZipManifest(ctx.id, entry, "0", ctx.cache);
  const target = (manifest.entries || []).find((m) => m.name === member);
  if (!target) throw invalid("压缩包中没有这个子文档。", 404);

  return {
    archiveId: ctx.id,
    zipName: manifest.zipName,
    zipUrl: manifest.zipUrl,
    allowAnyFtp: !!entry.mirrored,
    entry: target,
  };
}

async function convertProtocolMember({ q, v, member }) {
  const target = await resolveMemberTarget({ q, v, member });
  return pdfTools.startConversion(target);
}

async function getProtocolMemberStatus({ q, v, member }) {
  const target = await resolveMemberTarget({ q, v, member });
  const hash = pdfTools.pdfCacheKey(
    target.archiveId,
    target.zipName,
    target.entry.name
  );
  const filename = pdfTools.displayPdfFilename(target.entry.name);
  return pdfTools.getJobView(hash, filename);
}

module.exports = {
  resolveProtocol,
  convertProtocolMember,
  getProtocolMemberStatus,
  parseThreeGppArchiveHtml,
  compareVersionsDesc,
};
