import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { LocalToolError, LIMITS } from "./proposalFill";
import type { FileBytes } from "./types";

export const W_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

const MAX_UNPACKED = 100 * 1024 * 1024;

export const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const cleanInline = (value: unknown): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

export function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function elementsNS(
  node: Element | Document,
  ns: string,
  name: string
): Element[] {
  return [...node.getElementsByTagNameNS(ns, name)];
}

export function wordChildren(
  node: Element | Document,
  name: string
): Element[] {
  return [...node.children].filter(
    (child) => child.namespaceURI === W_NS && child.localName === name
  );
}

export function parseXml(bytes: Uint8Array | undefined, ns?: string): Document {
  if (!bytes) throw new LocalToolError("invalid_package");
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new LocalToolError("invalid_package");
  }
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (
    doc.getElementsByTagName("parsererror").length ||
    (ns && doc.documentElement.namespaceURI !== ns)
  ) {
    throw new LocalToolError("invalid_package");
  }
  return doc;
}

export function unpackZip(bytes: Uint8Array): Record<string, FileBytes> {
  if (bytes.byteLength > LIMITS.fileBytes) {
    throw new LocalToolError("file_size");
  }
  let size = 0;
  let count = 0;
  try {
    return unzipSync(bytes, {
      filter: (entry) => {
        size += entry.originalSize;
        count += 1;
        if (size > MAX_UNPACKED || count > 5000) {
          throw new LocalToolError("expanded_size");
        }
        if (entry.name.includes("..") || entry.name.startsWith("/")) {
          throw new LocalToolError("invalid_package");
        }
        return true;
      },
    }) as Record<string, FileBytes>;
  } catch (error) {
    if (error instanceof LocalToolError) throw error;
    throw new LocalToolError("invalid_package");
  }
}

export async function readFileBytes(
  file: File,
  extension?: string
): Promise<FileBytes> {
  if (extension && !file.name.toLowerCase().endsWith(extension)) {
    throw new LocalToolError("file_type", { extension });
  }
  if (file.size > LIMITS.fileBytes) {
    throw new LocalToolError("file_size");
  }
  return new Uint8Array(await file.arrayBuffer());
}

export interface ParsedSheetRow {
  rowNumber: number;
  cells: Record<string, string>;
}

export interface ParsedWorksheet {
  name: string;
  rows: ParsedSheetRow[];
}

export function colIndexToLetters(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Read all worksheets from an .xlsx workbook without executing formulas or macros.
 * Preserves multi-line cell values (newlines inside cells).
 */
export function readXlsxSheets(bytes: Uint8Array): ParsedWorksheet[] {
  const entries = unpackZip(bytes);
  const workbook = parseXml(entries["xl/workbook.xml"], S_NS);
  const rels = parseXml(entries["xl/_rels/workbook.xml.rels"]);
  const relMap = new Map<string, { target: string; mode: string }>();
  for (const rel of [...rels.documentElement.children]) {
    const id = rel.getAttribute("Id") || "";
    const target = rel.getAttribute("Target") || "";
    const mode = rel.getAttribute("TargetMode") || "";
    if (id && target) relMap.set(id, { target, mode });
  }

  const sharedStrings = entries["xl/sharedStrings.xml"]
    ? elementsNS(
        parseXml(entries["xl/sharedStrings.xml"], S_NS),
        S_NS,
        "si"
      ).map((si) =>
        elementsNS(si, S_NS, "t")
          .map((t) => t.textContent || "")
          .join("")
      )
    : [];

  const styles = entries["xl/styles.xml"]
    ? parseXml(entries["xl/styles.xml"], S_NS)
    : null;
  const formats = new Map(
    styles
      ? elementsNS(styles, S_NS, "numFmt").map((f) => [
          f.getAttribute("numFmtId"),
          f.getAttribute("formatCode"),
        ])
      : []
  );
  const xfs = styles ? elementsNS(styles, S_NS, "cellXfs")[0]?.children : [];

  const cellValue = (cell: Element): string => {
    const type = cell.getAttribute("t");
    if (type === "inlineStr") {
      return elementsNS(cell, S_NS, "t")
        .map((t) => t.textContent || "")
        .join("");
    }
    const raw = elementsNS(cell, S_NS, "v")[0]?.textContent || "";
    if (type === "s") return sharedStrings[Number(raw)] ?? "";
    if (type === "e") return "";
    if (type === "str") return raw;
    const format = formats.get(
      xfs?.[Number(cell.getAttribute("s") || 0)]?.getAttribute("numFmtId") ??
        null
    );
    return format && /^0+$/.test(format) && /^\d+$/.test(raw)
      ? raw.padStart(format.length, "0")
      : raw;
  };

  const result: ParsedWorksheet[] = [];
  for (const sheetNode of elementsNS(workbook, S_NS, "sheet")) {
    const name = sheetNode.getAttribute("name") || "";
    const rid = sheetNode.getAttributeNS(R_NS, "id") || "";
    const rel = relMap.get(rid);
    if (!rel || rel.mode === "External") continue;
    const sheetPath = rel.target.startsWith("/")
      ? rel.target.slice(1)
      : `xl/${rel.target.replace(/^\.\//, "")}`;
    if (!entries[sheetPath]) continue;
    const sheetDoc = parseXml(entries[sheetPath], S_NS);
    const rows: ParsedSheetRow[] = [];
    for (const rowNode of elementsNS(sheetDoc, S_NS, "row")) {
      const rowNumber = Number(rowNode.getAttribute("r") || 0);
      const cells: Record<string, string> = {};
      for (const cell of elementsNS(rowNode, S_NS, "c")) {
        const col = (cell.getAttribute("r") || "").replace(/\d+/g, "");
        if (!col) continue;
        cells[col] = cellValue(cell);
      }
      rows.push({ rowNumber, cells });
    }
    result.push({ name, rows });
  }
  return result;
}

/**
 * Build a clean, standards-compliant .xlsx workbook with all values stored as inline strings
 * so Excel never corrupts version strings like "20.24" or "29.520".
 */
export function buildSimpleXlsx(options: {
  sheetName: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  columnWidths?: readonly number[];
}): FileBytes {
  const safeSheetName =
    options.sheetName.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet1";

  const colsXml = options.columnWidths?.length
    ? `<cols>${options.columnWidths
        .map(
          (width, idx) =>
            `<col min="${idx + 1}" max="${idx + 1}" width="${width}" customWidth="1"/>`
        )
        .join("")}</cols>`
    : "";

  const renderRow = (
    values: readonly string[],
    rowIdx: number,
    styleId: number
  ) => {
    const cells = values
      .map((val, colIdx) => {
        const ref = `${colIndexToLetters(colIdx)}${rowIdx}`;
        if (!val) return `<c r="${ref}" s="${styleId}"/>`;
        return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(val)}</t></is></c>`;
      })
      .join("");
    return `<row r="${rowIdx}">${cells}</row>`;
  };

  const sheetRows = [
    renderRow(options.headers, 1, 1),
    ...options.rows.map((r, i) => renderRow(r, i + 2, 2)),
  ].join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${S_NS}" xmlns:r="${R_NS}">
  <sheets>
    <sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // Style 0: default, Style 1: bold header with subtle fill, Style 2: text-formatted body cell (@)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${S_NS}">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD0D7DE"/></left>
      <right style="thin"><color rgb="FFD0D7DE"/></right>
      <top style="thin"><color rgb="FFD0D7DE"/></top>
      <bottom style="thin"><color rgb="FFD0D7DE"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyNumberFormat="1"><alignment vertical="top"/></xf>
  </cellXfs>
</styleSheet>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${S_NS}">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  ${colsXml}
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRels),
      "xl/workbook.xml": strToU8(workbookXml),
      "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
      "xl/styles.xml": strToU8(stylesXml),
      "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    },
    { level: 6 }
  ) as FileBytes;
}

/**
 * Extract visible text of a Word element, skipping deleted/moved-from runs.
 */
export function visibleWordText(node: Element): string {
  return elementsNS(node, W_NS, "t")
    .filter((t) => {
      for (
        let parent = t.parentElement;
        parent && parent !== node.parentElement;
        parent = parent.parentElement
      ) {
        if (
          parent.namespaceURI === W_NS &&
          (parent.localName === "del" || parent.localName === "moveFrom")
        ) {
          return false;
        }
      }
      return true;
    })
    .map((t) => t.textContent || "")
    .join("");
}

/**
 * Extract paragraph text preserving tabs as single spaces and skipping deleted runs.
 */
export function visibleParagraphText(p: Element): string {
  const parts: string[] = [];
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (child.namespaceURI === W_NS) {
        if (child.localName === "del" || child.localName === "moveFrom") {
          continue;
        }
        if (child.localName === "t") {
          parts.push(child.textContent || "");
          continue;
        }
        if (child.localName === "tab") {
          parts.push("\t");
          continue;
        }
        if (child.localName === "br") {
          parts.push("\n");
          continue;
        }
      }
      walk(child);
    }
  };
  walk(p);
  return parts.join("");
}

export function triggerBrowserDownload(
  bytes: Uint8Array,
  filename: string,
  mimeType: string
): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
