import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const LIMITS = {
  files: 50,
  meetingFiles: 20,
  fileBytes: 20 * 1024 * 1024,
  batchBytes: 100 * 1024 * 1024,
};
const MAX_UNPACKED = 100 * 1024 * 1024;
export const FIELD_NAMES = ["tdoc", "cr", "revision", "version"];
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const elements = (node, ns, name) => [...node.getElementsByTagNameNS(ns, name)];
const children = (node, name) =>
  [...node.children].filter(
    (child) => child.namespaceURI === W && child.localName === name
  );

export class LocalToolError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}
const fail = (code, params) => {
  throw new LocalToolError(code, params);
};

function xml(bytes, ns) {
  if (!bytes) fail("invalid_package");
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail("invalid_package");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (
    doc.getElementsByTagName("parsererror").length ||
    (ns && doc.documentElement.namespaceURI !== ns)
  )
    fail("invalid_package");
  return doc;
}

function unpack(bytes) {
  if (bytes.byteLength > LIMITS.fileBytes) fail("file_size");
  let size = 0;
  let count = 0;
  try {
    return unzipSync(bytes, {
      filter: (entry) => {
        size += entry.originalSize;
        count += 1;
        if (size > MAX_UNPACKED || count > 5000) fail("expanded_size");
        if (entry.name.includes("..") || entry.name.startsWith("/"))
          fail("invalid_package");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof LocalToolError) throw error;
    fail("invalid_package");
  }
}

async function fileBytes(file, extension) {
  if (!file.name.toLowerCase().endsWith(extension))
    fail("file_type", { extension });
  if (file.size > LIMITS.fileBytes) fail("file_size");
  return new Uint8Array(await file.arrayBuffer());
}

// Read only the official meeting list schema. No formulas, links or macros are executed.
export async function readMeetingList(file) {
  const entries = unpack(await fileBytes(file, ".xlsx"));
  const workbook = xml(entries["xl/workbook.xml"], S);
  const sheets = elements(workbook, S, "sheet").filter(
    (s) => s.getAttribute("name") === "TDoc_List"
  );
  if (sheets.length !== 1) fail("missing_sheet");
  const id = sheets[0].getAttributeNS(R, "id");
  const rels = xml(entries["xl/_rels/workbook.xml.rels"]);
  const rel = [...rels.documentElement.children].find(
    (r) => r.getAttribute("Id") === id
  );
  const target = rel?.getAttribute("Target") || "";
  if (!target || rel.getAttribute("TargetMode") === "External")
    fail("invalid_package");
  const sheetPath = target.startsWith("/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = xml(entries[sheetPath], S);
  const strings = entries["xl/sharedStrings.xml"]
    ? elements(xml(entries["xl/sharedStrings.xml"], S), S, "si").map((si) =>
        elements(si, S, "t")
          .map((t) => t.textContent)
          .join("")
      )
    : [];
  const styles = entries["xl/styles.xml"]
    ? xml(entries["xl/styles.xml"], S)
    : null;
  const formats = new Map(
    styles
      ? elements(styles, S, "numFmt").map((f) => [
          f.getAttribute("numFmtId"),
          f.getAttribute("formatCode"),
        ])
      : []
  );
  const xfs = styles ? elements(styles, S, "cellXfs")[0]?.children : [];
  const valueOf = (cell) => {
    if (cell.getAttribute("t") === "inlineStr")
      return elements(cell, S, "t")
        .map((t) => t.textContent)
        .join("");
    const raw = elements(cell, S, "v")[0]?.textContent || "";
    if (cell.getAttribute("t") === "s") return strings[Number(raw)] ?? "";
    if (cell.getAttribute("t") === "e") return "";
    const format = formats.get(
      xfs?.[Number(cell.getAttribute("s") || 0)]?.getAttribute("numFmtId")
    );
    return /^0+$/.test(format || "") && /^\d+$/.test(raw)
      ? raw.padStart(format.length, "0")
      : raw;
  };
  const rows = elements(sheet, S, "row");
  const header = rows.find((row) =>
    elements(row, S, "c").some((c) => normalize(valueOf(c)) === "tdoc")
  );
  if (!header) fail("missing_columns");
  const columns = new Map(
    elements(header, S, "c").map((c) => [
      (c.getAttribute("r") || "").replace(/\d/g, ""),
      clean(valueOf(c)),
    ])
  );
  const required = [
    "TDoc",
    "Title",
    "Source",
    "Spec",
    "Release",
    "Version",
    "CR",
    "CR revision",
  ];
  if (required.some((name) => ![...columns.values()].includes(name)))
    fail("missing_columns");
  const records = [];
  for (const row of rows) {
    if (Number(row.getAttribute("r")) <= Number(header.getAttribute("r")))
      continue;
    const values = {};
    for (const cell of elements(row, S, "c"))
      values[columns.get((cell.getAttribute("r") || "").replace(/\d/g, ""))] =
        clean(valueOf(cell));
    if (!values.Title || (values.Type && normalize(values.Type) !== "cr"))
      continue;
    if (!values.Type && !values.CR) continue;
    records.push({
      id: row.getAttribute("r"),
      tdoc: values.TDoc || "",
      title: values.Title,
      source: values.Source || "",
      spec: values.Spec || "",
      release: values.Release || "",
      version: values.Version || "",
      cr: values.CR || "",
      revision: values["CR revision"] || "",
    });
  }
  if (!records.length) fail("no_records");
  return records;
}

// Excel row numbers are local to each workbook. Keep source identity separate
// so selecting row 2 in one list cannot select row 2 in another list.
export function mergeMeetingLists(files) {
  return files.flatMap((file) =>
    (file.records || []).map((record) => ({
      ...record,
      id: `${file.id}:${record.id}`,
      row: record.id,
      sourceFile: file.name,
    }))
  );
}

function visibleTexts(node) {
  return elements(node, W, "t").filter((t) => {
    for (
      let parent = t.parentElement;
      parent && parent !== node.parentElement;
      parent = parent.parentElement
    ) {
      if (
        parent.namespaceURI === W &&
        ["del", "moveFrom"].includes(parent.localName)
      )
        return false;
    }
    return true;
  });
}
const text = (node) =>
  visibleTexts(node)
    .map((t) => t.textContent)
    .join("");
function writable(node) {
  // Avoid changing fields under revision, protected controls, fields or alternate representations.
  return ![
    "ins",
    "del",
    "moveFrom",
    "moveTo",
    "sdt",
    "fldChar",
    "fldSimple",
    "instrText",
    "txbxContent",
  ].some((name) => elements(node, W, name).length);
}
function replacement(node, start, end, value) {
  if (!writable(node)) fail("complex_field");
  const texts = visibleTexts(node);
  if (!texts.length) {
    if (start || end) fail("template");
    const paragraph = elements(node, W, "p")[0];
    if (!paragraph) fail("template");
    const run = node.ownerDocument.createElementNS(W, "w:r");
    const t = node.ownerDocument.createElementNS(W, "w:t");
    t.textContent = value;
    run.append(t);
    paragraph.append(run);
    return;
  }
  let offset = 0;
  let inserted = false;
  for (const t of texts) {
    const current = t.textContent;
    const a = offset;
    const b = a + current.length;
    offset = b;
    if (b < start || a > end) continue;
    if (b === start && current.length && start !== end) continue;
    const left = current.slice(0, Math.max(0, start - a));
    const right = current.slice(Math.max(0, end - a));
    t.textContent = left + (inserted ? "" : value) + right;
    t.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve"
    );
    inserted = true;
  }
  if (!inserted) fail("template");
}

export async function readProposal(file) {
  const bytes = await fileBytes(file, ".docx");
  const entries = unpack(bytes);
  if (
    Object.keys(entries).some(
      (name) =>
        name.startsWith("_xmlsignatures/") || name.endsWith("vbaProject.bin")
    )
  )
    fail("signed_document");
  if (entries["word/settings.xml"]) {
    const protection = elements(
      xml(entries["word/settings.xml"], W),
      W,
      "documentProtection"
    );
    if (
      protection.some((node) =>
        /^(?:1|true|on)$/.test(node.getAttributeNS(W, "enforcement"))
      )
    )
      fail("protected_document");
  }
  const doc = xml(entries["word/document.xml"], W);
  const { fields, metadata, tdoc } = locateProposal(doc);
  return {
    file,
    bytes,
    metadata,
    values: {
      tdoc: tdoc.value,
      ...Object.fromEntries(
        Object.entries(fields).map(([key, node]) => [key, clean(text(node))])
      ),
    },
  };
}

function locateProposal(doc) {
  const body = elements(doc, W, "body")[0];
  if (!body) fail("template");
  const tables = children(body, "tbl");
  const forms = [];
  for (const table of tables)
    for (const row of children(table, "tr")) {
      const cells = children(row, "tc");
      const labels = cells.map((cell) => normalize(text(cell)));
      const cr = labels.indexOf("cr");
      const rev = labels.indexOf("rev");
      const version = labels.findIndex((v) => /^current version\s*:?$/.test(v));
      if (cr > 0 && rev > cr && version > rev && cells[version + 1])
        forms.push({ table, cells, cr, rev, version });
    }
  if (forms.length !== 1) fail("template");
  const form = forms[0];
  const fields = {
    cr: form.cells[form.cr + 1],
    revision: form.cells[form.rev + 1],
    version: form.cells[form.version + 1],
  };
  const spec = clean(text(form.cells[form.cr - 1]));
  const metadata = {};
  for (const table of tables)
    for (const row of children(table, "tr")) {
      const cells = children(row, "tc");
      for (let i = 0; i < cells.length - 1; i++) {
        const label = normalize(text(cells[i])).replace(/\s*:\s*$/, "");
        const key = {
          title: "title",
          "source to wg": "source",
          release: "release",
        }[label];
        if (!key) continue;
        if (metadata[key] !== undefined) fail("template");
        metadata[key] = clean(text(cells[i + 1]));
      }
    }
  if (!metadata.title || !metadata.source || !spec || !metadata.release)
    fail("metadata");
  const prefix = [];
  for (const child of body.children) {
    if (child === form.table) break;
    if (child.localName === "p") prefix.push(child);
  }
  const numbered = [];
  for (const p of prefix) {
    const value = text(p);
    for (const match of value.matchAll(
      /[A-Z][A-Z0-9]*-\d{2}[\da-z?_-]{2,}\b/gi
    ))
      numbered.push({
        node: p,
        start: match.index,
        end: match.index + match[0].length,
        value: match[0],
      });
  }
  let tdoc;
  if (numbered.length === 1) tdoc = numbered[0];
  else if (!numbered.length) {
    // A blank number is supported only when an explicit tab separates it from the meeting name.
    const candidates = prefix.filter(
      (p) =>
        /3GPP.*Meeting/i.test(text(p)) &&
        elements(p, W, "tab").some((tab) => {
          const run = tab.parentElement;
          return (
            run?.localName === "r" &&
            run.parentElement === p &&
            !visibleTexts(p).some(
              (t) => tab.compareDocumentPosition(t) & 4 && clean(t.textContent)
            )
          );
        })
    );
    if (candidates.length !== 1) fail("tdoc_location");
    const node = candidates[0];
    tdoc = {
      node,
      start: text(node).length,
      end: text(node).length,
      value: "",
      blank: true,
    };
  } else fail("tdoc_location");
  if (
    Object.values(fields).some((field) => !writable(field)) ||
    !writable(tdoc.node)
  )
    fail("complex_field");
  return { fields, metadata: { ...metadata, spec }, tdoc };
}

export function matchRecords(proposal, records) {
  const m = proposal.metadata;
  const sameTitle = records.filter(
    (r) => normalize(r.title) === normalize(m.title)
  );
  const exact = sameTitle.filter((r) =>
    ["spec", "release", "source"].every(
      (key) => normalize(r[key]) === normalize(m[key])
    )
  );
  return {
    candidates: sameTitle,
    selectedId: exact.length === 1 ? exact[0].id : "",
    reason: !sameTitle.length
      ? "no_match"
      : exact.length > 1
        ? "ambiguous"
        : exact.length === 0
          ? "metadata_conflict"
          : "",
  };
}
const placeholder = (value, field) => {
  if (!value) return true;
  if (field === "tdoc")
    return /^[A-Z][A-Z0-9]*-\d{2}[\da-z?_-]*[a-z?][\da-z?_-]*$/i.test(value);
  return /^(?:x+|tbd|\?+|待填写)$/i.test(value);
};
export function planProposal(
  proposal,
  record,
  allowConflicts = false,
  naming = "number"
) {
  if (
    !record ||
    !/^[A-Z][A-Z0-9]*-\d{6,}$/i.test(record.tdoc) ||
    !/^\d+$/.test(record.cr) ||
    !/^\d+\.\d+\.\d+$/.test(record.version) ||
    (record.revision && !/^(?:-|\d+)$/.test(record.revision))
  )
    fail("record_values");
  const metadataConflicts = ["spec", "release", "source"].filter(
    (key) => normalize(proposal.metadata[key]) !== normalize(record[key])
  );
  const changes = FIELD_NAMES.map((field) => {
    const before = proposal.values[field];
    const after =
      field === "revision" && !record.revision ? before : record[field];
    const changed = before !== after;
    const conflict = changed && !placeholder(before, field);
    return { field, before, after, changed, conflict };
  });
  const conflicts =
    metadataConflicts.length + changes.filter((c) => c.conflict).length;
  const stem = proposal.file.name.replace(/\.docx$/i, "");
  const suffix =
    naming === "preserve"
      ? stem.replace(/^[A-Z][A-Z0-9]*-\d{2}[\da-z?]*[\s_-]*/i, "").trim()
      : "";
  const outputName = `${record.tdoc}${suffix ? ` ${suffix}` : ""}.docx`
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .replace(/[. ]+$/, "");
  return {
    record,
    changes,
    metadataConflicts,
    conflicts,
    ready: !conflicts || allowConflicts,
    outputName,
  };
}

export function duplicateNames(plans) {
  const counts = new Map();
  for (const plan of plans)
    if (plan?.ready)
      counts.set(
        normalize(plan.outputName),
        (counts.get(normalize(plan.outputName)) || 0) + 1
      );
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([name]) => name)
  );
}
export const isDuplicateName = (name, duplicates) =>
  duplicates.has(normalize(name));

export async function generateProposal(proposal, plan) {
  if (!plan.ready) fail("unconfirmed");
  // Re-read the original package so preview and export never share mutable XML nodes.
  const entries = unpack(proposal.bytes);
  const doc = xml(entries["word/document.xml"], W);
  const { fields, tdoc } = locateProposal(doc);
  for (const change of plan.changes) {
    if (!change.changed) continue;
    if (change.field !== "tdoc") {
      const node = fields[change.field];
      replacement(node, 0, text(node).length, change.after);
    } else {
      if (change.before) {
        replacement(tdoc.node, tdoc.start, tdoc.end, change.after);
      } else {
        // Place the new number in its own run after the final existing tab.
        const run = doc.createElementNS(W, "w:r");
        const properties = elements(tdoc.node, W, "rPr").at(-1);
        if (properties) run.append(properties.cloneNode(true));
        const t = doc.createElementNS(W, "w:t");
        t.textContent = change.after;
        run.append(t);
        tdoc.node.append(run);
      }
    }
  }
  if (plan.changes.some((c) => c.changed))
    entries["word/document.xml"] = strToU8(
      new XMLSerializer().serializeToString(doc)
    );
  // Untouched package entries, including revisions, images and embedded objects, retain their bytes.
  return zipSync(entries, { level: 6 });
}

export function packageResults(results, report) {
  const entries = Object.create(null);
  for (const result of results) {
    if (entries[result.name]) fail("duplicate");
    entries[result.name] = result.bytes;
  }
  entries["处理清单.json"] = strToU8(JSON.stringify(report, null, 2));
  return zipSync(entries, { level: 0 });
}
