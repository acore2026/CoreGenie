const path = require("node:path");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const { load } = require("cheerio");
const {
  WG_PATHS,
  ALL_WG_KEYS,
  invalid,
  resolveWgRoute,
  tdocPrefixFromWgKey,
  extractConferenceNumber,
  classifyDocId,
  extractTdocIdsFromText,
} = require("./threeGppClassifier");
const {
  PUBLIC_FTP_BASE,
  getSourceStatus,
  assertAllowedThreeGppUrl,
  isAbortError,
  curlText,

  curlHeadOk,
  getActiveSources,
  listFromSource,
  checkFileInSource,
  downloadDocument,
} = require("./threeGppSources");
const { resolveProtocol } = require("./protocolFinder");
const pdfTools = require("./protocolFinderPdf");

const MAX_DEFAULT_CONFERENCES = 20;
const MAX_BATCH_ITEMS = 50;
const BATCH_CONCURRENCY = 5;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error("request_cancelled"), {
      name: "AbortError",
      status: 499,
      publicMessage: "已取消本次查询。",
    });
  }
}

async function runWithConcurrency(items, limit, worker, signal) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function next() {
    while (nextIdx < items.length) {
      throwIfAborted(signal);
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    next()
  );
  await Promise.all(runners);
  return results;
}

function sortMeetingEntries(entries, docPrefix) {
  const parsed = entries
    .filter((e) => e.isDir)
    .map((e) => ({
      ...e,
      number: extractConferenceNumber(e.name, docPrefix),
    }))
    .filter((e) => e.number !== null);

  parsed.sort(
    (a, b) =>
      b.number - a.number ||
      b.name.localeCompare(a.name, "en", { numeric: true })
  );
  return parsed;
}

async function listWgMeetings({ group, refresh = false, signal } = {}) {
  const route = resolveWgRoute(group);
  if (!route) {
    throw invalid("请选择有效的工作组（如 SA2、RAN1、CT4）。");
  }
  const docPrefix = tdocPrefixFromWgKey(route.wgKey);
  const sources = getActiveSources();
  let lastError = null;

  for (const source of sources) {
    throwIfAborted(signal);
    try {
      const entries = await listFromSource(source, route.wgPath, {
        signal,
        refresh,
      });
      const meetings = sortMeetingEntries(entries, docPrefix).map((m) => ({
        id: m.name,
        number: m.number,
        label: `${route.wgKey}#${m.number} · ${m.name}`,
        url: m.url,
        relPath: m.relPath,
      }));
      if (meetings.length > 0) {
        return {
          group: route.wgKey,
          wgPath: route.wgPath,
          sourceId: source.id,
          sourceLabel: source.label,
          meetings,
        };
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
    }
  }

  throw invalid(
    lastError
      ? `暂时无法读取 ${route.wgKey} 会议列表，请稍后重试。`
      : `未找到 ${route.wgKey} 的会议目录。`,
    502
  );
}

async function inspectZipMembers(found, { signal } = {}) {
  const { wordMaxBytes } = pdfTools.getConfig();
  const maxMb = Math.round(wordMaxBytes / 1024 / 1024);

  throwIfAborted(signal);
  const { entries: rawEntries, totalSize } = await pdfTools.inspectRemoteZip(
    found.url,
    { allowAnyFtp: true, signal }
  );

  const archiveId = `doc:${new URL(found.url).href}`;
  const zipName = path.posix.basename(found.relPath);
  const members = [];

  for (const raw of rawEntries) {
    const isWord = /\.(docx?|rtf)$/i.test(raw.name);
    const isPdf = /\.pdf$/i.test(raw.name);
    const tooLarge = isWord && raw.uncompressedSize > wordMaxBytes;
    const methodSupported = raw.method === 0 || raw.method === 8;
    const convertible = isWord && !tooLarge && methodSupported;

    let reason;
    if (!isWord && !isPdf) reason = "非 Word/PDF 文件，可直接下载查看。";
    else if (tooLarge)
      reason = `文件超过 ${maxMb} MB 转换上限，请直接下载查看。`;
    else if (!methodSupported) reason = "暂不支持该压缩格式，请直接下载原包。";

    const hash = pdfTools.pdfCacheKey(archiveId, zipName, raw.name);
    const filename = pdfTools.displayPdfFilename(raw.name);
    const view = convertible
      ? await pdfTools.getJobView(hash, filename)
      : { status: isPdf ? "pdf" : "unsupported", cached: false };

    members.push({
      name: raw.name,
      size: raw.uncompressedSize,
      compressedSize: raw.compressedSize,
      isWord,
      isPdf,
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

  return { totalSize, members };
}

async function inspectIfAvailable(hit, signal, inspect = true) {
  if (inspect && /\.zip$/i.test(hit.relPath)) {
    try {
      return await inspectZipMembers(hit, { signal });
    } catch (err) {
      throwIfAborted(signal);
      return {
        totalSize: hit.size || 0,
        members: [],
        warning: err.publicMessage || "暂时无法列出包内文件，可以先下载原包。",
      };
    }
  }
  return { totalSize: hit.size || 0, members: [] };
}

function filterConferencesByHint(conferences, hint) {
  const clean = String(hint || "").trim();
  if (!clean) return conferences.slice(0, MAX_DEFAULT_CONFERENCES);
  if (/^all$/i.test(clean)) return conferences;

  const numOnly = clean.match(/^#?(\d+)$/);
  if (numOnly) {
    const targetNum = Number(numOnly[1]);
    const exact = conferences.filter((c) => c.number === targetNum);
    return exact;
  }

  const lower = clean.toLowerCase();
  const fuzzy = conferences.filter((c) => c.name.toLowerCase().includes(lower));
  return fuzzy;
}

async function resolveTdoc({
  classification,
  hint = "",
  refresh = false,
  signal,
  onProgress,
  inspect = true,
}) {
  const docId = classification.normalizedId;
  const { wgKey, wgPath, docPrefix } = classification;
  const sources = getActiveSources();
  const searchedFolders = [];
  let accessedDirectory = false;

  for (const source of sources) {
    throwIfAborted(signal);

    // 1. Check mirror sync inbox first (when local/HTTP mirror is configured)
    if (source.id !== "public" && !hint) {
      const syncRel = `Meetings_3GPP_SYNC/${wgKey}/INBOX/${docId}.zip`;
      const syncHit = await checkFileInSource(source, syncRel, { signal });
      if (syncHit) {
        const zipInfo = await inspectIfAvailable(syncHit, signal, inspect);
        return {
          kind: "tdoc",
          id: docId,
          wgKey,
          wgPath,
          meetingFolder: `Meetings_3GPP_SYNC/${wgKey}`,
          meetingNumber: null,
          subfolder: "INBOX",
          sourceId: source.id,
          sourceLabel: source.label,
          relPath: syncHit.relPath,
          zipName: `${docId}.zip`,
          zipUrl: syncHit.url,
          dirUrl:
            source.id === "local-mirror"
              ? null
              : new URL(".", syncHit.url).href,
          ...zipInfo,
          searchedCount: 1,
        };
      }
    }

    // 2. List WG conferences and search newest first (or matching meeting hint)
    let rawEntries;
    try {
      rawEntries = await listFromSource(source, wgPath, { signal, refresh });
    } catch (err) {
      if (isAbortError(err)) throw err;
      continue;
    }

    accessedDirectory = true;
    const conferences = sortMeetingEntries(rawEntries, docPrefix);
    const candidates = filterConferencesByHint(conferences, hint);

    // Probe conferences in small batches (concurrency 4) preserving newest-first priority
    const BATCH_SIZE = 4;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      throwIfAborted(signal);
      const slice = candidates.slice(i, i + BATCH_SIZE);
      onProgress?.({
        group: wgKey,
        source: source.label,
        meeting: slice[0].name,
        checked: i,
        total: candidates.length,
      });
      const checks = await Promise.all(
        slice.map(async (conf) => {
          searchedFolders.push(conf.name);
          for (const subfolder of ["Docs", "INBOX"]) {
            const relPath = `${wgPath}/${conf.name}/${subfolder}/${docId}.zip`;
            const hit = await checkFileInSource(source, relPath, { signal });
            if (hit) {
              return { conf, subfolder, hit };
            }
          }
          // When user explicitly gave a meeting hint, also check directory listing for case/extension differences
          if (String(hint || "").trim()) {
            for (const subfolder of ["Docs", "INBOX"]) {
              try {
                const subEntries = await listFromSource(
                  source,
                  `${wgPath}/${conf.name}/${subfolder}`,
                  { signal }
                );
                const lowerTarget = docId.toLowerCase();
                const match = subEntries.find(
                  (e) =>
                    !e.isDir &&
                    (e.name.toLowerCase() === `${lowerTarget}.zip` ||
                      e.name.toLowerCase().startsWith(`${lowerTarget}.`))
                );
                if (match) {
                  return {
                    conf,
                    subfolder,
                    hit: {
                      sourceId: source.id,
                      sourceLabel: source.label,
                      relPath: match.relPath,
                      localPath: match.localPath,
                      url: match.url,
                      size: undefined,
                    },
                  };
                }
              } catch (err) {
                if (isAbortError(err)) throw err;
              }
            }
          }
          return null;
        })
      );

      const matched = checks.find(Boolean);
      if (matched) {
        const { conf, subfolder, hit } = matched;
        const zipName = path.posix.basename(hit.relPath);
        const zipInfo = await inspectIfAvailable(hit, signal, inspect);
        return {
          kind: "tdoc",
          id: docId,
          wgKey,
          wgPath,
          meetingFolder: conf.name,
          meetingNumber: conf.number,
          subfolder,
          sourceId: source.id,
          sourceLabel: source.label,
          relPath: hit.relPath,
          zipName,
          zipUrl: hit.url,
          dirUrl:
            source.id === "local-mirror" ? null : new URL(".", hit.url).href,
          ...zipInfo,
          searchedCount: searchedFolders.length,
        };
      }
    }
  }

  if (!accessedDirectory)
    throw invalid("无法读取工作组目录，请检查网络或镜像配置后重试。", 502);
  const hintText = String(hint || "").trim()
    ? `会议 ${String(hint).trim()} 中`
    : `最近 ${MAX_DEFAULT_CONFERENCES} 次会议中`;
  throw invalid(
    `在 ${wgKey} 的${hintText}未找到 ${docId}。可以填具体会议号，或输入 all 扩大到全部历史会议。`,
    404
  );
}

async function resolveWorkshop({ classification, refresh = false, signal }) {
  const docId = classification.normalizedId;
  const lowerDoc = docId.toLowerCase();
  const sources = getActiveSources();
  const candidateRoots = ["tsg_sa/TSG_SA/Workshops", "workshop"];

  for (const source of sources) {
    for (const root of candidateRoots) {
      if (root === "workshop" && source.id === "public") continue;
      throwIfAborted(signal);
      let entries;
      try {
        entries = await listFromSource(source, root, { signal, refresh });
      } catch (err) {
        if (isAbortError(err)) throw err;
        continue;
      }

      // Direct file match in workshop root
      const directFile = entries.find(
        (e) => !e.isDir && e.name.toLowerCase().split(".")[0] === lowerDoc
      );
      if (directFile) {
        const zipInfo = await inspectIfAvailable(directFile, signal);
        return {
          kind: "workshop",
          id: docId,
          wgKey: "Workshop",
          wgPath: root,
          meetingFolder: root,
          subfolder: "",
          sourceId: source.id,
          sourceLabel: source.label,
          relPath: directFile.relPath,
          zipName: directFile.name,
          zipUrl: directFile.url,
          dirUrl:
            source.id === "local-mirror"
              ? null
              : new URL(".", directFile.url).href,
          ...zipInfo,
        };
      }

      // Workshop IDs start with the two-digit year. Prefer matching dated folders.
      const year = docId.match(/^SWS-(\d{2})/)?.[1];
      const subDirs = entries
        .filter((e) => e.isDir)
        .sort(
          (a, b) =>
            Number(!!year && b.name.startsWith("20" + year)) -
              Number(!!year && a.name.startsWith("20" + year)) ||
            b.name.localeCompare(a.name, "en", { numeric: true })
        );
      for (const dir of subDirs) {
        throwIfAborted(signal);
        for (const sub of ["Docs", "INBOX", ""]) {
          const relPath = sub
            ? `${dir.relPath}/${sub}/${docId}.zip`
            : `${dir.relPath}/${docId}.zip`;
          const hit = await checkFileInSource(source, relPath, { signal });
          if (hit) {
            const zipInfo = await inspectIfAvailable(hit, signal);
            return {
              kind: "workshop",
              id: docId,
              wgKey: "Workshop",
              wgPath: root,
              meetingFolder: dir.name,
              subfolder: sub,
              sourceId: source.id,
              sourceLabel: source.label,
              relPath: hit.relPath,
              zipName: `${docId}.zip`,
              zipUrl: hit.url,
              dirUrl:
                source.id === "local-mirror"
                  ? null
                  : new URL(".", hit.url).href,
              ...zipInfo,
            };
          }
        }
      }
    }
  }

  throw invalid(`在 3GPP Workshops 目录中未找到 ${docId}。`, 404);
}

async function resolveRfc({ classification, signal }) {
  const num = classification.rfcNumber;
  const id = `rfc${num}`;
  const sources = getActiveSources();

  // Check local mirror first if configured
  const localMirror = sources.find((s) => s.id === "local-mirror");
  if (localMirror) {
    const localHit = await checkFileInSource(
      localMirror,
      `IETF-mirror/rfc/${id}.txt`,
      { signal }
    );
    if (localHit) {
      return {
        kind: "rfc",
        id: id.toUpperCase(),
        number: num,
        sourceLabel: "本地镜像",
        txtUrl: `https://www.rfc-editor.org/rfc/${id}.txt`,
        htmlUrl: `https://www.rfc-editor.org/rfc/${id}.html`,
        pdfUrl: `https://www.rfc-editor.org/rfc/pdfrfc/${id}.txt.pdf`,
        datatrackerUrl: `https://datatracker.ietf.org/doc/${id}/`,
        localUrl: localHit.url,
      };
    }
  }

  const txtUrl = `https://www.rfc-editor.org/rfc/${id}.txt`;
  const check = await curlHeadOk(txtUrl, { signal, timeoutSec: 10 });
  if (!check.ok) {
    if (
      check.error?.code !== 22 ||
      !/404|410/.test(String(check.error?.stderr))
    )
      throw invalid("暂时无法连接官方文档网站，请稍后重试。", 502);
    throw invalid(`未在 RFC Editor 找到 RFC ${num}，请核对编号。`, 404);
  }

  return {
    kind: "rfc",
    id: id.toUpperCase(),
    number: num,
    sourceLabel: "RFC Editor 官方",
    txtUrl,
    htmlUrl: `https://www.rfc-editor.org/rfc/${id}.html`,
    pdfUrl: `https://www.rfc-editor.org/rfc/pdfrfc/${id}.txt.pdf`,
    datatrackerUrl: `https://datatracker.ietf.org/doc/${id}/`,
  };
}

async function resolveIetfDraft({ classification, signal }) {
  const id = classification.normalizedId;
  const txtUrl = `https://www.ietf.org/archive/id/${id}.txt`;
  const check = await curlHeadOk(txtUrl, { signal, timeoutSec: 10 });
  if (!check.ok) {
    if (
      check.error?.code !== 22 ||
      !/404|410/.test(String(check.error?.stderr))
    )
      throw invalid("暂时无法连接官方文档网站，请稍后重试。", 502);
    throw invalid(
      `未在 IETF Archive 找到 ${id}.txt（如省略了版本号，可尝试补上 -00、-01 等后缀）。`,
      404
    );
  }
  return {
    kind: "ietf-draft",
    id,
    sourceLabel: "IETF Archive 官方",
    txtUrl,
    datatrackerUrl: `https://datatracker.ietf.org/doc/${id.replace(/-\d{2}$/, "")}/`,
  };
}

async function lookupDocument({
  q,
  hint = "",
  refresh = "0",
  signal,
  onProgress,
}) {
  const classification = classifyDocId(q);
  const doRefresh = refresh === "1" || refresh === true;

  if (classification.kind === "spec") {
    if (
      hint &&
      !/^(?:rel-?)?(?:[0-9]|[12][0-9]|30)$/i.test(String(hint).trim())
    )
      throw invalid("Release 请填写数字，例如 18。");
    const specResult = await resolveProtocol({
      q,
      signal,
      rel: String(hint || "").trim() || undefined,
      refresh: doRefresh ? "1" : "0",
    });
    return {
      kind: "spec",
      classification,
      specResult,
    };
  }

  if (classification.kind === "tdoc") {
    return resolveTdoc({
      classification,
      onProgress,
      hint,
      refresh: doRefresh,
      signal,
    });
  }

  if (classification.kind === "workshop") {
    return resolveWorkshop({
      classification,
      refresh: doRefresh,
      signal,
    });
  }

  if (classification.kind === "rfc") {
    return resolveRfc({ classification, signal });
  }

  if (classification.kind === "ietf-draft") {
    return resolveIetfDraft({ classification, signal });
  }

  throw invalid("无法识别的文档类型。", 400);
}

async function decorateFileItem(item, source, groupKey) {
  const lower = item.name.toLowerCase();
  const isWord = /\.(docx?|rtf)$/i.test(lower);
  const isHtml = /\.html?$/i.test(lower);
  const isPdf = /\.pdf$/i.test(lower);
  const isZip = /\.zip$/i.test(lower);

  const archiveId = `direct:${new URL(item.url).href}`;
  const hash = isWord
    ? pdfTools.pdfCacheKey(archiveId, item.name, item.name)
    : null;
  const pdfFilename = isWord ? pdfTools.displayPdfFilename(item.name) : null;
  const view = isWord ? await pdfTools.getJobView(hash, pdfFilename) : null;

  return {
    name: item.name,
    url: item.url,
    relPath: item.relPath,
    date: item.date,
    size: item.size,
    group: groupKey,
    sourceLabel: source.label,
    isWord,
    mirrored: source.id !== "public",
    isHtml,
    isPdf,
    isZip,
    convertible: isWord,
    status: view?.status || (isPdf ? "pdf" : "idle"),
    cached: Boolean(view?.cached),
    pdfPath: view?.pdfPath,
    pdfSize: view?.size,
    progress: view?.progress,
    error: view?.error,
  };
}

async function resolveAgendaAndNotes({
  group,
  meeting,
  chair = "",
  signal,
} = {}) {
  const route = resolveWgRoute(group);
  if (!route) throw invalid("请选择有效的工作组（如 SA2、RAN1、CT4）。");
  const cleanMeeting = String(meeting || "").trim();
  if (!cleanMeeting) throw invalid("请选择或输入会议号（如 170）。");

  const docPrefix = tdocPrefixFromWgKey(route.wgKey);
  const sources = getActiveSources();
  const chairLower = String(chair || "")
    .trim()
    .toLowerCase();

  for (const source of sources) {
    throwIfAborted(signal);
    let wgEntries;
    try {
      wgEntries = await listFromSource(source, route.wgPath, { signal });
    } catch (err) {
      if (isAbortError(err)) throw err;
      continue;
    }

    const conferences = sortMeetingEntries(wgEntries, docPrefix);
    const targetConf =
      conferences.find(
        (c) => c.name.toLowerCase() === cleanMeeting.toLowerCase()
      ) || filterConferencesByHint(conferences, cleanMeeting)[0];

    if (!targetConf) continue;

    const meetingRel = `${route.wgPath}/${targetConf.name}`;
    let rootFiles = [];
    try {
      rootFiles = await listFromSource(source, meetingRel, { signal });
    } catch (err) {
      if (isAbortError(err)) throw err;
      continue;
    }

    const agendaFiles = [];
    const chairNoteFiles = [];
    const reportFiles = [];

    for (const item of rootFiles) {
      if (item.isDir) continue;
      const lower = item.name.toLowerCase();
      if (/tdocsbyagenda|agenda/i.test(lower)) {
        agendaFiles.push(item);
      }
      if (/chair.*note|chairman.*note|chair_note/i.test(lower)) {
        chairNoteFiles.push(item);
      }
    }

    // Check Agenda/ subfolder if no agenda in root
    const agendaDir = rootFiles.find(
      (e) => e.isDir && /^agenda$/i.test(e.name)
    );
    if (agendaDir) {
      try {
        const sub = await listFromSource(source, agendaDir.relPath, { signal });
        for (const item of sub) {
          if (item.isDir) continue;
          const lower = item.name.toLowerCase();
          if (/tdocsbyagenda|agenda/i.test(lower) || /\.html?$/i.test(lower)) {
            agendaFiles.push(item);
          }
          if (/chair.*note|chairman.*note/i.test(lower)) {
            chairNoteFiles.push(item);
          }
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
      }
    }

    // RAN1 special case (or any WG with Report/ folder): Minutes_report* & chair notes
    const reportDir = rootFiles.find(
      (e) => e.isDir && /^report$/i.test(e.name)
    );
    if (reportDir) {
      try {
        const sub = await listFromSource(source, reportDir.relPath, { signal });
        for (const item of sub) {
          if (item.isDir) continue;
          const lower = item.name.toLowerCase();
          if (/minutes_report|report/i.test(lower)) {
            reportFiles.push(item);
          }
          if (/chair.*note|chairman.*note/i.test(lower)) {
            chairNoteFiles.push(item);
          }
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
      }
    }

    // Check Inbox/Docs lightly if no chair notes found yet and chair keyword specified
    if (!chairNoteFiles.length) {
      const inboxDir = rootFiles.find(
        (e) => e.isDir && /^inbox$/i.test(e.name)
      );
      if (inboxDir) {
        try {
          const sub = await listFromSource(source, inboxDir.relPath, {
            signal,
          });
          for (const item of sub) {
            if (item.isDir) continue;
            if (/chair.*note|chairman.*note/i.test(item.name)) {
              chairNoteFiles.push(item);
            }
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
        }
      }
    }

    agendaFiles.sort(
      (a, b) =>
        Number(/tdocsbyagenda/i.test(b.name)) -
          Number(/tdocsbyagenda/i.test(a.name)) ||
        Number(/\.html?$/i.test(b.name)) - Number(/\.html?$/i.test(a.name)) ||
        b.name.localeCompare(a.name, "en", { numeric: true })
    );

    reportFiles.sort(
      (a, b) =>
        Number(/minutes_report/i.test(b.name)) -
          Number(/minutes_report/i.test(a.name)) ||
        b.name.localeCompare(a.name, "en", { numeric: true })
    );

    chairNoteFiles.sort((a, b) => {
      if (chairLower) {
        const am = Number(a.name.toLowerCase().includes(chairLower));
        const bm = Number(b.name.toLowerCase().includes(chairLower));
        if (bm !== am) return bm - am;
      }
      return b.name.localeCompare(a.name, "en", { numeric: true });
    });

    const [agenda, chairNotes, reports] = await Promise.all([
      Promise.all(
        agendaFiles
          .slice(0, 12)
          .map((f) => decorateFileItem(f, source, route.wgKey))
      ),
      Promise.all(
        chairNoteFiles
          .slice(0, 20)
          .map((f) => decorateFileItem(f, source, route.wgKey))
      ),
      Promise.all(
        reportFiles
          .slice(0, 12)
          .map((f) => decorateFileItem(f, source, route.wgKey))
      ),
    ]);

    if (
      !agenda.length &&
      !chairNotes.length &&
      !reports.length &&
      source.id !== "public"
    )
      continue;
    return {
      group: route.wgKey,
      meetingFolder: targetConf.name,
      meetingNumber: targetConf.number,
      meetingUrl: `${PUBLIC_FTP_BASE}${meetingRel}/`,
      sourceLabel: source.label,
      agenda,
      chairNotes,
      reports,
    };
  }

  throw invalid(
    `未找到 ${route.wgKey} 对应的会议目录（${cleanMeeting}），请核对会议号。`,
    404
  );
}

function parseChangeRequestsHtml(html) {
  const $ = load(String(html || ""));
  const items = [];
  $("tr").each((_, row) => {
    const cells = $(row).children("td");
    if (cells.length < 15) return;
    const tdoc =
      cells.eq(9).find('img[id="wgTdocDetailsImg"]').attr("title")?.trim() ||
      cells.eq(9).find("a").text().trim();
    if (!/^(?:S3i-?\d{5,8}|[SCR][P1-6]-\d{5,8}(?:r\d{1,2})?)$/i.test(tdoc))
      return;
    const cell = (index) => cells.eq(index).text().trim();
    items.push({
      tdoc,
      spec: cell(2),
      cr: cell(3),
      revision: cell(4),
      release: cell(7),
      title: cell(8),
      wgStatus: cell(10),
      meeting: cell(11),
      tsgStatus: cell(14),
      withdrawn: [cell(10), cell(14)].some((status) =>
        /^withdrawn$/i.test(status)
      ),
    });
  });
  return items;
}

async function searchChangeRequests({
  spec,
  release,
  wgStatus,
  tsgStatus,
  meeting,
  workItem,
  includeWithdrawn = false,
  page = 1,
  signal,
} = {}) {
  if (![spec, meeting, workItem].some((x) => typeof x === "string" && x.trim()))
    throw invalid("请填写规范号、会议或 Work Item。");
  const number = Number(page);
  if (!Number.isInteger(number) || number < 1 || number > 10000)
    throw invalid("页码无效。");
  const rel = String(release || "")
    .trim()
    .replace(/^rel-?/i, "");
  if (rel && !/^(?:[1-9]|[12]\d|30)$/.test(rel))
    throw invalid("Release 请填写数字，例如 18。");
  const params = new URLSearchParams({ q: "1", pageindex: String(number - 1) });
  for (const [key, value] of Object.entries({
    specnumber: spec,
    release: rel && String(Number(rel) + 175),
    wgstatus: wgStatus,
    tsgstatus: tsgStatus,
    meeting,
    workitem: workItem,
  })) {
    if (value) params.set(key, String(value).trim());
  }
  const portalUrl = "https://portal.3gpp.org/ChangeRequests.aspx?" + params;
  const html = await curlText(portalUrl, { signal, timeoutSec: 35 });
  const rows = parseChangeRequestsHtml(html);
  const $ = load(html);
  if (
    !rows.length &&
    !/rgNoRecords|No records to display|No records found|No change requests found/i.test(
      html
    ) &&
    !$('table[id*="rgCrList"]').length
  )
    throw invalid("未能读取 Portal 的 CR 列表，请稍后重试。", 502);
  const pageCount = Number(
    $(".rgInfoPart")
      .first()
      .text()
      .match(/in\s+([\d,]+)\s+pages?/i)?.[1]
      ?.replace(/,/g, "")
  );
  const hasMore =
    number < pageCount ||
    $('a[href*="rgCrListChangePage"]')
      .toArray()
      .some((el) => {
        const pageNumber = $(el)
          .attr("href")
          ?.match(/rgCrListChangePage=(\d+)_/i)?.[1];
        return Number(pageNumber) > number;
      });
  return {
    items: includeWithdrawn ? rows : rows.filter((r) => !r.withdrawn),
    totalFound: rows.length,
    withdrawnCount: rows.filter((r) => r.withdrawn).length,
    page: number,
    hasMore,
    portalUrl,
  };
}

async function listBatchItems({
  mode,
  url = "",
  group = "",
  meeting = "",
  signal,
} = {}) {
  if (mode === "url") {
    const { url: safeUrl, isMirror } = assertAllowedThreeGppUrl(url);
    const source = getActiveSources().find((s) =>
      isMirror ? s.id === "http-mirror" : s.id === "public"
    );
    const relative = decodeURIComponent(
      new URL(safeUrl).pathname.slice(new URL(source.baseUrl).pathname.length)
    );
    let entries;
    for (const candidate of isMirror ? [source] : getActiveSources()) {
      try {
        entries = (
          await listFromSource(candidate, relative, { signal })
        ).filter((e) => !e.isDir);
        if (entries.length || candidate.id === "public") break;
      } catch (error) {
        if (isAbortError(error) || candidate === source) throw error;
      }
    }
    entries ||= [];
    const files = entries
      .filter((e) => {
        const name = e.name;
        const isTdocLike =
          name.slice(0, 3).toUpperCase() === "SWS" ||
          name[2] === "-" ||
          /^S3i\d/i.test(name);
        const isDoc = /\.(zip|docx?|pdf|xlsx?)$/i.test(name);
        return isTdocLike || isDoc;
      })
      .map((e) => ({
        name: e.name,
        url: e.url,
        date: e.date,
        size: e.size,
        isTdoc:
          e.name.slice(0, 3).toUpperCase() === "SWS" ||
          e.name[2] === "-" ||
          /^S3i\d/i.test(e.name),
      }));
    return { sourceUrl: safeUrl, files };
  }

  if (mode === "meeting") {
    const route = resolveWgRoute(group);
    if (!route) throw invalid("请选择有效的工作组。");
    const cleanMeeting = String(meeting || "").trim();
    if (!cleanMeeting) throw invalid("请选择或输入会议号。");
    const docPrefix = tdocPrefixFromWgKey(route.wgKey);
    const sources = getActiveSources();

    for (const source of sources) {
      throwIfAborted(signal);
      let wgEntries;
      try {
        wgEntries = await listFromSource(source, route.wgPath, { signal });
      } catch (err) {
        if (isAbortError(err)) throw err;
        continue;
      }
      const conferences = sortMeetingEntries(wgEntries, docPrefix);
      const targetConf =
        conferences.find(
          (c) => c.name.toLowerCase() === cleanMeeting.toLowerCase()
        ) || filterConferencesByHint(conferences, cleanMeeting)[0];
      if (!targetConf) continue;

      const files = [];
      const seen = new Set();
      for (const sub of ["Docs", "INBOX"]) {
        const subRel = `${route.wgPath}/${targetConf.name}/${sub}`;
        try {
          const list = await listFromSource(source, subRel, { signal });
          for (const item of list) {
            if (item.isDir || seen.has(item.name.toLowerCase())) continue;
            if (!/\.(zip|docx?|pdf)$/i.test(item.name)) continue;
            seen.add(item.name.toLowerCase());
            files.push({
              name: item.name,
              url: item.url,
              relPath: item.relPath,
              subfolder: sub,
              date: item.date,
              size: item.size,
              isTdoc:
                item.name.slice(0, 3).toUpperCase() === "SWS" ||
                item.name[2] === "-" ||
                /^S3i\d/i.test(item.name),
            });
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
        }
      }
      if (!files.length && source.id !== "public") continue;
      return {
        group: route.wgKey,
        meetingFolder: targetConf.name,
        sourceUrl: `${PUBLIC_FTP_BASE}${route.wgPath}/${targetConf.name}/Docs/`,
        files,
      };
    }

    throw invalid(
      `未找到 ${route.wgKey} 会议 ${cleanMeeting} 的 Docs 目录。`,
      404
    );
  }

  throw invalid("不支持的批量列表模式。");
}

async function parseBatchExcelBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    const expanded = new AdmZip(buffer)
      .getEntries()
      .reduce((sum, entry) => sum + entry.header.size, 0);
    if (expanded > 64 * 1024 * 1024)
      throw invalid("表格解压后超过 64 MB，请缩小表格后重试。", 413);
    await workbook.xlsx.load(buffer);
  } catch (err) {
    if (err.publicMessage) throw err;
    throw invalid("无法读取该 Excel 文件，请确认是有效的 .xlsx 表格。");
  }

  const seen = new Set();
  const tdocs = [];
  const sheets = [];

  for (const sheet of workbook.worksheets) {
    let sheetCount = 0;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const text = String(cell.text || cell.value || "").trim();
        if (!text) return;
        for (const id of extractTdocIdsFromText(text)) {
          const key = id.toUpperCase();
          if (!seen.has(key)) {
            seen.add(key);
            tdocs.push(id);
            sheetCount++;
          }
        }
      });
    });
    if (sheetCount > 0) {
      sheets.push({ name: sheet.name, count: sheetCount });
    }
  }

  return {
    tdocs,
    total: tdocs.length,
    sheets,
  };
}

async function buildBatchArchive({ items, meetingHint = "", signal } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw invalid("请至少选择一个要下载的文档。");
  }
  if (items.length > MAX_BATCH_ITEMS) {
    throw invalid(
      `单次批量打包最多支持 ${MAX_BATCH_ITEMS} 份文档，请分批下载。`
    );
  }

  const zip = new AdmZip();
  const usedNames = new Set();
  const errors = [];
  let succeeded = 0;
  let totalBytes = 0;

  await runWithConcurrency(
    items,
    BATCH_CONCURRENCY,
    async (item) => {
      throwIfAborted(signal);
      const label = String(
        item?.name || item?.tdocId || item?.url || "document"
      );
      try {
        if (!item || typeof item !== "object")
          throw invalid("无效的下载条目。");
        let downloadUrl = item.url || "";
        let filename = item.name || "";

        if (!downloadUrl && item.tdocId) {
          const c = classifyDocId(item.tdocId);
          if (c.kind === "tdoc") {
            const resolved = await resolveTdoc({
              classification: c,
              hint: item.meetingHint || meetingHint,
              inspect: false,
              signal,
            });
            downloadUrl = resolved.zipUrl;
            filename = resolved.zipName;
          } else if (c.kind === "workshop") {
            const resolved = await resolveWorkshop({
              classification: c,
              signal,
            });
            downloadUrl = resolved.zipUrl;
            filename = resolved.zipName;
          } else {
            throw invalid(`不支持在批量包中按编号自动拉取：${item.tdocId}`);
          }
        }

        const { url: safeUrl } = assertAllowedThreeGppUrl(downloadUrl);
        if (!filename) {
          filename = path.posix.basename(
            decodeURIComponent(new URL(safeUrl).pathname)
          );
        }
        const safeName =
          path.posix
            .basename(String(filename).replace(/\\/g, "/"))
            .replace(/[^\p{L}\p{N} ._-]+/gu, "_")
            .replace(/^\.+/, "")
            .slice(0, 200) || "document";
        let finalName = safeName;
        let suffix = 1;
        while (usedNames.has(finalName.toLowerCase())) {
          const ext = path.posix.extname(safeName);
          const stem = safeName.slice(0, safeName.length - ext.length);
          finalName = `${stem}_${suffix++}${ext}`;
        }
        usedNames.add(finalName.toLowerCase());

        const buf = await downloadDocument(safeUrl, {
          signal,
          maxBytes: 32 * 1024 * 1024,
        });
        if (totalBytes + buf.length > 128 * 1024 * 1024)
          throw invalid("压缩包达到 128 MB，请分批下载。");
        totalBytes += buf.length;
        zip.addFile(finalName, buf);
        succeeded++;
      } catch (err) {
        if (isAbortError(err)) throw err;
        errors.push({
          item: label,
          error: err?.publicMessage || "无法读取源文件，请稍后重试。",
        });
      }
    },
    signal
  );

  if (succeeded === 0) {
    throw invalid(
      `所选文档均未下载成功（${errors[0]?.error || "请检查网络或文档编号"}）。`,
      502
    );
  }

  if (errors.length > 0) {
    const lines = [
      `批量下载汇总：成功 ${succeeded} 份，失败 ${errors.length} 份`,
      "",
      "未成功下载的条目：",
      ...errors.map((e) => `- ${e.item}: ${e.error}`),
    ];
    zip.addFile("_下载结果汇总.txt", Buffer.from(lines.join("\n"), "utf8"));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer: zip.toBuffer(),
    filename: `3gpp-batch-${stamp}-${succeeded}files.zip`,
    succeeded,
    failed: errors.length,
    total: items.length,
    errors,
  };
}

async function convertDocFile({ zipUrl, directUrl, member }) {
  if (directUrl) {
    const { url: safeUrl } = assertAllowedThreeGppUrl(directUrl);
    const name = path.posix.basename(
      decodeURIComponent(new URL(safeUrl).pathname)
    );
    return pdfTools.startConversion({
      archiveId: `direct:${safeUrl}`,
      zipName: name,
      directUrl: safeUrl,
      allowAnyFtp: true,
      entry: { name, uncompressedSize: 0, compressedSize: 0 },
    });
  }

  if (!zipUrl || !member) {
    throw invalid("请提供文档地址与目标文件名。");
  }
  const { url: safeUrl } = assertAllowedThreeGppUrl(zipUrl);
  const inspected = await pdfTools.inspectRemoteZip(safeUrl, {
    allowAnyFtp: true,
  });
  const target = (inspected.entries || []).find((m) => m.name === member);
  if (!target) throw invalid("压缩包中未找到该文档。", 404);
  const zipName = path.posix.basename(
    decodeURIComponent(new URL(safeUrl).pathname)
  );
  return pdfTools.startConversion({
    archiveId: `doc:${safeUrl}`,
    zipName,
    zipUrl: safeUrl,
    allowAnyFtp: true,
    entry: target,
  });
}

async function getDocConvertStatus({ zipUrl, directUrl, member }) {
  if (directUrl) {
    const { url: safeUrl } = assertAllowedThreeGppUrl(directUrl);
    const name = path.posix.basename(
      decodeURIComponent(new URL(safeUrl).pathname)
    );
    const hash = pdfTools.pdfCacheKey(`direct:${safeUrl}`, name, name);
    return pdfTools.getJobView(hash, pdfTools.displayPdfFilename(name));
  }
  if (!zipUrl || !member) throw invalid("缺少查询参数。");
  const { url: safeUrl } = assertAllowedThreeGppUrl(zipUrl);
  const zipName = path.posix.basename(
    decodeURIComponent(new URL(safeUrl).pathname)
  );
  const hash = pdfTools.pdfCacheKey(`doc:${safeUrl}`, zipName, member);
  return pdfTools.getJobView(hash, pdfTools.displayPdfFilename(member));
}

async function extractDocMember({ zipUrl, member, signal }) {
  if (!zipUrl || !member) throw invalid("缺少压缩包地址或文件名。");
  throwIfAborted(signal);
  const { url: safeUrl } = assertAllowedThreeGppUrl(zipUrl);
  const inspected = await pdfTools.inspectRemoteZip(safeUrl, {
    allowAnyFtp: true,
    signal,
  });
  const target = (inspected.entries || []).find((m) => m.name === member);
  if (!target) throw invalid("压缩包中未找到该文件。", 404);
  const buffer = await pdfTools.extractMemberBuffer({
    zipUrl: safeUrl,
    entry: target,
    allowAnyFtp: true,
    signal,
  });
  const baseName =
    path.posix.basename(target.name).replace(/[^A-Za-z0-9._-]+/g, "_") ||
    "document";
  return { buffer, filename: baseName };
}

function getAssistantConfig() {
  return {
    groups: ALL_WG_KEYS,
    wgPaths: WG_PATHS,
    sources: getSourceStatus(),
    maxBatchItems: MAX_BATCH_ITEMS,
  };
}

module.exports = {
  getAssistantConfig,
  listWgMeetings,
  lookupDocument,
  resolveAgendaAndNotes,
  parseChangeRequestsHtml,
  searchChangeRequests,
  listBatchItems,
  parseBatchExcelBuffer,
  buildBatchArchive,
  convertDocFile,
  getDocConvertStatus,
  extractDocMember,
  downloadDocument,
};
