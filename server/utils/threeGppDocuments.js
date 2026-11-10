const ExcelJS = require("exceljs");
const AdmZip = require("adm-zip");
const catalog = require("./threeGppCatalog");

const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const escapePattern = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Read the Secretariat export, not the similarly named meeting Index ZIP,
// which can contain historical worksheets and a lagging working copy.
async function parseTdocList(buffer, source, group) {
  const zip = new AdmZip(buffer);
  if (
    zip.getEntries().reduce((sum, entry) => sum + entry.header.size, 0) >
    64 * 1024 * 1024
  )
    throw new Error("TDoc 清单解压后超过读取大小限制。");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const prefix = group.replace(/^SA/, "S").replace(/^CT/, "C");
  const tdocPattern = new RegExp(`^${escapePattern(prefix)}-\\d{6,8}$`, "i");
  for (const sheet of workbook.worksheets) {
    for (
      let headerRow = 1;
      headerRow <= Math.min(sheet.rowCount, 20);
      headerRow++
    ) {
      const columns = new Map();
      sheet
        .getRow(headerRow)
        .eachCell((cell, column) =>
          columns.set(clean(cell.text).toLowerCase(), column)
        );
      if (
        ![
          "tdoc",
          "title",
          "source",
          "agenda item",
          "tdoc status",
          "spec",
        ].every((name) => columns.has(name))
      )
        continue;
      const documents = new Map();
      for (
        let rowNumber = headerRow + 1;
        rowNumber <= sheet.rowCount;
        rowNumber++
      ) {
        const row = sheet.getRow(rowNumber);
        const at = (name) =>
          columns.has(name) ? clean(row.getCell(columns.get(name)).text) : "";
        const document = at("tdoc").toUpperCase();
        if (!document) continue;
        if (!tdocPattern.test(document))
          throw new Error("TDoc 清单包含其他工作组或无法识别的文档编号。");
        const item = {
          document,
          agenda: at("agenda item"),
          agendaTitle: at("agenda item description"),
          title: at("title"),
          source: at("source"),
          spec: at("spec"),
          version: at("version"),
          workItem: at("related wis"),
          release: at("release"),
          type: at("type"),
          purpose: at("for"),
          status: at("tdoc status"),
          uploaded: at("uploaded"),
          isRevisionOf: at("is revision of"),
          revisedTo: at("revised to"),
          comments: at("secretary remarks"),
          referenceUrl: source,
        };
        if (
          !item.title ||
          (item.agenda && !/^\d+(?:\.\d+)*$/.test(item.agenda))
        )
          throw new Error(
            "TDoc 清单中的标题或议程项无法识别，不能据此确认下载范围。"
          );
        if (
          documents.has(document) &&
          JSON.stringify(documents.get(document)) !== JSON.stringify(item)
        )
          throw new Error(`TDoc 清单中 ${document} 存在相互冲突的记录。`);
        documents.set(document, item);
      }
      return [...documents.values()];
    }
  }
  throw new Error(
    "TDoc 清单缺少文档编号、标题、来源、议程项、状态或 Spec 列。"
  );
}

async function meetingDocuments(group, meeting, { signal } = {}) {
  signal?.throwIfAborted();
  const warnings = [];
  const sourceErrors = [];
  let archives = null;
  let docsSource = null;
  let listSource = null;
  let documents = null;
  const requestSignal = () =>
    AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(120_000),
    ]);
  try {
    const rootLinks = catalog.links(
      await catalog.readOfficial(meeting.source, 0, requestSignal()),
      meeting.source
    );
    const docs = rootLinks.find((link) => /^docs$/i.test(link.name));
    if (!docs) throw new Error("会议目录中未找到 Docs 文件夹。");
    docsSource = docs.url.replace(/\/$/, "") + "/";
    const docsLinks = catalog.links(
      await catalog.readOfficial(docsSource, 0, requestSignal()),
      docsSource
    );
    const prefix = group.replace(/^SA/, "S").replace(/^CT/, "C");
    const zipPattern = new RegExp(
      `^(${escapePattern(prefix)}-\\d{6,8})\\.zip$`,
      "i"
    );
    archives = Object.fromEntries(
      docsLinks.flatMap((link) => {
        const match = link.name.match(zipPattern);
        return match ? [[match[1].toUpperCase(), link.url]] : [];
      })
    );
    const listName = `TDoc_List_Meeting_${group}#${meeting.number}${meeting.suffix || ""}.xlsx`;
    const list = docsLinks.find(
      (link) => link.name.toLowerCase() === listName.toLowerCase()
    );
    if (!list) throw new Error("Docs 目录中未找到对应会议的 TDoc 表。");
    listSource = list.url;
    documents = await parseTdocList(
      await catalog.readOfficialBuffer(list.url, 0, requestSignal()),
      list.url,
      group
    );
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    sourceErrors.push({
      source: listSource || docsSource || meeting.source,
      error: error.message,
    });
    warnings.push(
      `未能读取当前会议的完整 TDoc 表：${error.message} 已退回官方议程清单，下载范围尚未确认。`
    );
  }

  let source, items, selectionSource, fetchedAt;
  if (documents !== null) {
    source = listSource;
    selectionSource = "official-tdoc-list";
    items = [
      ...new Map(
        documents
          .filter((d) => d.agenda)
          .map((d) => [d.agenda, { value: d.agenda, title: d.agendaTitle }])
      ).values(),
    ];
    fetchedAt = new Date().toISOString();
  } else {
    let fallback;
    try {
      fallback = await catalog.agenda(group, meeting.id, {
        meeting,
        includeDocuments: true,
        fresh: true,
        signal: requestSignal(),
      });
    } catch (error) {
      signal?.throwIfAborted();
      sourceErrors.push({ source: meeting.source, error: error.message });
      fallback = {
        source: meeting.source,
        warning: `官方议程也无法读取：${error.message}`,
        fetchedAt: new Date().toISOString(),
      };
    }
    if (fallback.warning) warnings.push(fallback.warning);
    documents = fallback.documents || [];
    items = fallback.items || [];
    source = fallback.source;
    fetchedAt = fallback.fetchedAt;
    selectionSource = "official-agenda-section";
  }
  const indexed = new Set(documents.map((d) => d.document));
  const unindexedTdocs = archives
    ? Object.keys(archives).filter((tdoc) => !indexed.has(tdoc))
    : [];
  if (unindexedTdocs.length)
    warnings.push(
      `Docs 中有 ${unindexedTdocs.length} 份 ZIP 未列入当前清单，无法确认是否属于所选 KI；未自动扩大下载范围。`
    );
  if (documents.some((d) => !d.agenda))
    warnings.push(
      "TDoc 表中存在尚未分配议程项的文档，无法确认是否属于所选 KI。"
    );
  return {
    source,
    items,
    fetchedAt,
    selectionSource,
    docsSource,
    warnings,
    sourceErrors,
    unindexedTdocs,
    documents: documents.map((document) => ({
      ...document,
      downloadUrl: archives?.[document.document] || null,
      availability:
        archives === null
          ? "unknown"
          : archives[document.document]
            ? "listed"
            : /^reserved$/i.test(document.status)
              ? "reserved"
              : "missing",
    })),
  };
}

module.exports = { parseTdocList, meetingDocuments };
