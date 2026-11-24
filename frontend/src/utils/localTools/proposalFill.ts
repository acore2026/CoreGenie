import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

import type {
  Proposal,
  ExportFile,
  FieldName,
  FileBytes,
  MeetingFile,
  MeetingRecord,
  MatchResult,
  MetadataField,
  NamingMode,
  ProposalMetadata,
  ProposalPlan,
  SourcedRecord,
} from "./types";

type XmlNode = Element | Document;
type NumberLocation = {
  node: Element;
  start: number;
  end: number;
  value: string;
  blank?: boolean;
};
type CRForm = {
  table: Element;
  cells: Element[];
  cr: number;
  rev: number;
  version: number;
};

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
export const FIELD_NAMES: readonly FieldName[] = [
  "tdoc",
  "cr",
  "revision",
  "version",
];
const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const elements = (node: XmlNode, ns: string, name: string): Element[] => [
  ...node.getElementsByTagNameNS(ns, name),
];
const children = (node: XmlNode, name: string): Element[] =>
  [...node.children].filter(
    (child) => child.namespaceURI === W && child.localName === name
  );

export class LocalToolError extends Error {
  code: string;
  params: Record<string, string | number>;

  constructor(code: string, params: Record<string, string | number> = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}
const fail: (
  code: string,
  params?: Record<string, string | number>
) => never = (code, params) => {
  throw new LocalToolError(code, params);
};

function xml(bytes: Uint8Array | undefined, ns?: string): Document {
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

function unpack(bytes: Uint8Array): Record<string, FileBytes> {
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

async function fileBytes(file: File, extension: string): Promise<FileBytes> {
  if (!file.name.toLowerCase().endsWith(extension))
    fail("file_type", { extension });
  if (file.size > LIMITS.fileBytes) fail("file_size");
  return new Uint8Array(await file.arrayBuffer());
}

// Read only the official meeting list schema. No formulas, links or macros are executed.
export async function readMeetingList(file: File): Promise<MeetingRecord[]> {
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
  if (!target || rel?.getAttribute("TargetMode") === "External")
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
  const valueOf = (cell: Element): string => {
    if (cell.getAttribute("t") === "inlineStr")
      return elements(cell, S, "t")
        .map((t) => t.textContent)
        .join("");
    const raw = elements(cell, S, "v")[0]?.textContent || "";
    if (cell.getAttribute("t") === "s") return strings[Number(raw)] ?? "";
    if (cell.getAttribute("t") === "e") return "";
    const format = formats.get(
      xfs?.[Number(cell.getAttribute("s") || 0)]?.getAttribute("numFmtId") ??
        null
    );
    return format && /^0+$/.test(format) && /^\d+$/.test(raw)
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
  const required = ["TDoc", "Title", "Source"];
  if (required.some((name) => ![...columns.values()].includes(name)))
    fail("missing_columns");
  const records: MeetingRecord[] = [];
  for (const row of rows) {
    if (Number(row.getAttribute("r")) <= Number(header.getAttribute("r")))
      continue;
    const values: Record<string, string> = {};
    for (const cell of elements(row, S, "c"))
      values[
        columns.get((cell.getAttribute("r") || "").replace(/\d/g, "")) ?? ""
      ] = clean(valueOf(cell));
    if (!values.Title || !values.TDoc) continue;
    records.push({
      kind: normalize(values.Type) === "cr" || values.CR ? "cr" : "technical",
      id: row.getAttribute("r") || "",
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
export function mergeMeetingLists(files: MeetingFile[]): SourcedRecord[] {
  return files.flatMap((file) =>
    (file.records || []).map((record) => ({
      ...record,
      id: `${file.id}:${record.id}`,
      row: record.id,
      sourceFile: file.name,
    }))
  );
}

function visibleTexts(node: Element): Element[] {
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
const text = (node: Element): string =>
  visibleTexts(node)
    .map((t) => t.textContent)
    .join("");
function writable(node: Element): boolean {
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
function replacement(
  node: Element,
  start: number,
  end: number,
  value: string
): void {
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
    const current = t.textContent || "";
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

export async function readProposal(file: File): Promise<Proposal> {
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
        /^(?:1|true|on)$/.test(node.getAttributeNS(W, "enforcement") || "")
      )
    )
      fail("protected_document");
  }
  const doc = xml(entries["word/document.xml"], W);
  const { fields, metadata, tdoc, kind } = locateProposal(doc);
  return {
    kind,
    file,
    bytes,
    metadata,
    values: {
      tdoc: tdoc.value,
      cr: fields.cr ? clean(text(fields.cr)) : "",
      revision: fields.revision ? clean(text(fields.revision)) : "",
      version: fields.version ? clean(text(fields.version)) : "",
    },
  };
}

function locateProposal(doc: Document) {
  const body = elements(doc, W, "body")[0];
  if (!body) fail("template");
  const cover = coverElements(body);
  const tables = cover.filter((node) => node.localName === "tbl");
  const forms: CRForm[] = [];
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
  if (!forms.length) {
    // A damaged CR must never fall back to the ordinary-proposal parser.
    if (
      cover.some((node) => /CR-Form-v/i.test(text(node))) ||
      tables.some((table) => /current version|source to wg/i.test(text(table)))
    )
      fail("template");
    return locateTechnical(body);
  }
  if (forms.length !== 1) fail("template");
  const form = forms[0];
  const fields = {
    cr: form.cells[form.cr + 1],
    revision: form.cells[form.rev + 1],
    version: form.cells[form.version + 1],
  };
  const spec = clean(text(form.cells[form.cr - 1]));
  const metadata: Partial<ProposalMetadata> = {};
  // The cover metadata shares one table. Body tables can legitimately contain
  // fields such as "release" and must not participate in cover identification.
  const coverTables = tables.filter((table) => {
    const labels = children(table, "tr").flatMap((row) =>
      children(row, "tc")
        .slice(0, -1)
        .map((cell) => normalize(text(cell)).replace(/\s*:\s*$/, ""))
    );
    return labels.includes("title") && labels.includes("source to wg");
  });
  if (coverTables.length !== 1) fail("template");
  for (const table of coverTables)
    for (const row of children(table, "tr")) {
      const cells = children(row, "tc");
      for (let i = 0; i < cells.length - 1; i++) {
        const label = normalize(text(cells[i])).replace(/\s*:\s*$/, "");
        const metadataLabels: Partial<Record<string, keyof ProposalMetadata>> =
          {
            title: "title",
            "source to wg": "source",
            release: "release",
          };
        const key = metadataLabels[label];
        if (!key) continue;
        if (metadata[key] !== undefined) fail("template");
        metadata[key] = clean(text(cells[i + 1]));
      }
    }
  if (!metadata.title || !metadata.source || !spec || !metadata.release)
    fail("metadata");
  const prefix: Element[] = [];
  for (const child of body.children) {
    if (child === form.table) break;
    if (child.localName === "p") prefix.push(child);
  }
  const tdoc = locateNumber(prefix);
  if (
    Object.values(fields).some((field) => field && !writable(field)) ||
    !writable(tdoc.node)
  )
    fail("complex_field");
  return {
    kind: "cr" as const,
    fields: fields as Partial<Record<Exclude<FieldName, "tdoc">, Element>>,
    metadata: {
      title: metadata.title,
      source: metadata.source,
      release: metadata.release,
      spec,
    },
    tdoc,
  };
}

function locateNumber(prefix: Element[]): NumberLocation {
  // Revision history may list older TDocs before the cover. Prefer the meeting
  // header so those references are preserved rather than treated as candidates.
  const headers = prefix.filter((p) => /3GPP.*Meeting/i.test(text(p)));
  const numberParagraphs = headers.length
    ? headers
    : prefix.filter((p) => !/\brevision\s+of\b/i.test(text(p)));
  const numbered: NumberLocation[] = [];
  for (const p of numberParagraphs) {
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
  let tdoc: NumberLocation;
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
  if (!writable(tdoc.node)) fail("complex_field");
  return tdoc;
}

function coverElements(body: Element): Element[] {
  const cover: Element[] = [];
  for (const child of body.children) {
    if (cover.length >= 40) break;
    if (child.localName === "p" && /^\s*\d+[. ]+\s*[A-Za-z]/.test(text(child)))
      break;
    cover.push(child);
  }
  return cover;
}
function locateTechnical(body: Element) {
  const cover = coverElements(body);
  const metadata: ProposalMetadata = {
    title: "",
    source: "",
    spec: "",
    release: "",
  };
  const seen = new Set<string>();
  function add(label: string, value: string) {
    const key = label.toLowerCase() as keyof ProposalMetadata;
    if (seen.has(key)) fail("technical_template");
    seen.add(key);
    metadata[key] = clean(value);
  }
  for (const node of cover) {
    if (node.localName === "p") {
      const match = text(node).match(
        /^\s*(Title|Source|Spec|Release)\s*:\s*(.*)$/i
      );
      if (match) add(match[1], match[2]);
    } else if (node.localName === "tbl") {
      for (const row of children(node, "tr")) {
        const cells = children(row, "tc");
        const label = cells[0] && clean(text(cells[0])).replace(/:\s*$/, "");
        if (label && /^(Title|Source|Spec|Release)$/i.test(label) && cells[1])
          add(label, text(cells[1]));
      }
    }
  }
  if (!metadata.title || !metadata.source) fail("technical_template");
  return {
    kind: "technical" as const,
    fields: {} as Partial<Record<Exclude<FieldName, "tdoc">, Element>>,
    metadata,
    tdoc: locateNumber(cover.filter((node) => node.localName === "p")),
  };
}
const recordKind = (record: MeetingRecord) =>
  record.kind || (record.cr ? "cr" : "technical");
const metadataEqual = (
  proposal: Proposal,
  record: MeetingRecord,
  key: MetadataField
) => {
  const value = proposal.metadata[key];
  if (proposal.kind === "technical" && !value) return true;
  const canonical = (v: string) =>
    key === "spec"
      ? normalize(v).replace(/^3gpp\s+(?:ts|tr)\s+/, "")
      : normalize(v);
  return canonical(value) === canonical(record[key]);
};

export function matchRecords(
  proposal: Proposal,
  records: SourcedRecord[]
): MatchResult {
  const m = proposal.metadata;
  const sameTitle = records.filter(
    (r) =>
      recordKind(r) === proposal.kind &&
      normalize(r.title) === normalize(m.title)
  );
  const exact = sameTitle.filter((r) =>
    (["spec", "release", "source"] as const).every((key) =>
      metadataEqual(proposal, r, key)
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
const placeholder = (value: string, field: FieldName): boolean => {
  if (!value) return true;
  if (field === "tdoc")
    return /^[A-Z][A-Z0-9]*-\d{2}[\da-z?_-]*[a-z?][\da-z?_-]*$/i.test(value);
  return /^(?:x+|tbd|\?+|待填写)$/i.test(value);
};
export function planProposal(
  proposal: Proposal,
  record: SourcedRecord | undefined,
  allowConflicts = false,
  naming: NamingMode = "number"
): ProposalPlan {
  if (
    !record ||
    !/^[A-Z][A-Z0-9]*-\d{6,}$/i.test(record.tdoc) ||
    recordKind(record) !== proposal.kind ||
    (proposal.kind === "cr" &&
      (!/^\d+$/.test(record.cr) ||
        !/^\d+\.\d+\.\d+$/.test(record.version) ||
        (record.revision && !/^(?:-|\d+)$/.test(record.revision))))
  )
    fail("record_values");
  const metadataConflicts: MetadataField[] = (
    ["spec", "release", "source"] as const
  ).filter((key) => !metadataEqual(proposal, record, key));
  const fields: readonly FieldName[] =
    proposal.kind === "cr" ? FIELD_NAMES : ["tdoc"];
  const changes = fields.map((field) => {
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

export function duplicateNames(
  plans: readonly ({ ready?: boolean; outputName?: string } | null)[]
): Set<string> {
  const counts = new Map<string, number>();
  for (const plan of plans)
    if (plan?.ready && plan.outputName)
      counts.set(
        normalize(plan.outputName),
        (counts.get(normalize(plan.outputName)) || 0) + 1
      );
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([name]) => name)
  );
}
export const isDuplicateName = (
  name: string,
  duplicates: ReadonlySet<string>
): boolean => duplicates.has(normalize(name));

export async function generateProposal(
  proposal: Proposal,
  plan: ProposalPlan
): Promise<FileBytes> {
  if (!plan.ready) fail("unconfirmed");
  // Re-read the original package so preview and export never share mutable XML nodes.
  const entries = unpack(proposal.bytes);
  const doc = xml(entries["word/document.xml"], W);
  const { fields, tdoc } = locateProposal(doc);
  for (const change of plan.changes) {
    if (!change.changed) continue;
    if (change.field !== "tdoc") {
      const node = fields[change.field];
      if (!node) fail("template");
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

export function packageResults(
  results: ExportFile[],
  report: readonly unknown[]
): FileBytes {
  const entries: Record<string, FileBytes> = Object.create(null);
  for (const result of results) {
    if (entries[result.name]) fail("duplicate");
    entries[result.name] = result.bytes;
  }
  entries["处理清单.json"] = strToU8(JSON.stringify(report, null, 2));
  return zipSync(entries, { level: 0 });
}
