import { zipSync, strToU8 } from "fflate";
import { LocalToolError } from "./proposalFill";
import {
  R_NS,
  S_NS,
  W_NS,
  buildSimpleXlsx,
  cleanInline,
  colIndexToLetters,
  elementsNS,
  escapeXml,
  normalizeText,
  parseXml,
  readFileBytes,
  unpackZip,
  visibleWordText,
  wordChildren,
} from "./ooxml";
import type { FileBytes } from "./types";

/**
 * Exact 21-column schema of 3GPP Template_Bulk_TDoc_Allocation.xlsx.
 */
export const ALLOCATION_COLUMNS = [
  "Title",
  "Source",
  "Contact ID",
  "Type",
  "For",
  "Agenda item",
  "TDoc sort order within agenda item",
  "Is revision of",
  "Release",
  "Spec",
  "Version",
  "Related WIs",
  "CR",
  "CR revision",
  "CR category",
  "TSG CR Pack",
  "Reply to",
  "To",
  "Cc",
  "Original LS",
  "Reply in",
] as const;

export type AllocationColumn = (typeof ALLOCATION_COLUMNS)[number];
export type AllocationRowValues = Record<AllocationColumn, string>;

export interface AllocationItem {
  id: string;
  fileName: string;
  kind: "cr" | "technical" | "ls" | "unknown";
  values: AllocationRowValues;
  excluded: boolean;
  error?: string;
}

export const ALLOCATION_TYPE_OPTIONS = [
  "CR",
  "discussion",
  "pCR",
  "LS in",
  "LS out",
  "draft",
  "report",
  "other",
] as const;

export const ALLOCATION_FOR_OPTIONS = [
  "Agreement",
  "Approval",
  "Discussion",
  "Decision",
  "Information",
  "Action",
] as const;

export function emptyAllocationRow(): AllocationRowValues {
  const row = {} as AllocationRowValues;
  for (const col of ALLOCATION_COLUMNS) {
    row[col] = "";
  }
  return row;
}

function isPlaceholderValue(value: string): boolean {
  const v = cleanInline(value);
  if (!v) return true;
  return /^(?:x+|tbd|\?+|-|待填写|n\/a)$/i.test(v);
}

function normalizeSpec(raw: string): string {
  return cleanInline(raw).replace(/^3gpp\s+(?:ts|tr)\s+/i, "");
}

function coverElements(body: Element): Element[] {
  const cover: Element[] = [];
  for (const child of [...body.children]) {
    if (cover.length >= 45) break;
    if (
      child.localName === "p" &&
      /^\s*\d+[. ]+\s*[A-Za-z]/.test(visibleWordText(child))
    ) {
      break;
    }
    cover.push(child);
  }
  return cover;
}

function extractRevisionOf(paragraphs: Element[]): string {
  for (const p of paragraphs) {
    const text = visibleWordText(p);
    const match = text.match(
      /\brevision\s+of\s+([A-Z][A-Z0-9]*-\d{2}[\da-z_-]{2,})\b/i
    );
    if (match) return match[1];
  }
  return "";
}

/**
 * Read a 3GPP Word proposal (.docx) — CR, ordinary technical proposal, or LS —
 * and extract fields mapped to Template_Bulk_TDoc_Allocation.xlsx.
 */
export async function readWordForAllocation(
  file: File,
  id: string
): Promise<AllocationItem> {
  const bytes = await readFileBytes(file, ".docx");
  const entries = unpackZip(bytes);
  const doc = parseXml(entries["word/document.xml"], W_NS);
  const body = elementsNS(doc, W_NS, "body")[0];
  if (!body) throw new LocalToolError("invalid_package");

  const cover = coverElements(body);
  const tables = cover.filter((node) => node.localName === "tbl");
  const paragraphs = cover.filter((node) => node.localName === "p");
  const values = emptyAllocationRow();
  values["Is revision of"] = extractRevisionOf(paragraphs);

  // 1. Check CR-Form header table
  let crFormRow: {
    cells: Element[];
    cr: number;
    rev: number;
    version: number;
  } | null = null;
  for (const table of tables) {
    for (const row of wordChildren(table, "tr")) {
      const cells = wordChildren(row, "tc");
      const labels = cells.map((cell) => normalizeText(visibleWordText(cell)));
      const cr = labels.indexOf("cr");
      const rev = labels.indexOf("rev");
      const version = labels.findIndex((v) => /^current version\s*:?$/.test(v));
      if (cr > 0 && rev > cr && version > rev && cells[version + 1]) {
        crFormRow = { cells, cr, rev, version };
        break;
      }
    }
    if (crFormRow) break;
  }

  if (crFormRow) {
    values.Type = "CR";
    values.For = "Agreement";
    values.Spec = normalizeSpec(
      visibleWordText(crFormRow.cells[crFormRow.cr - 1])
    );
    const crRaw = cleanInline(
      visibleWordText(crFormRow.cells[crFormRow.cr + 1])
    );
    values.CR = isPlaceholderValue(crRaw) ? "" : crRaw;
    const revRaw = cleanInline(
      visibleWordText(crFormRow.cells[crFormRow.rev + 1])
    );
    values["CR revision"] = isPlaceholderValue(revRaw) ? "" : revRaw;
    const verRaw = cleanInline(
      visibleWordText(crFormRow.cells[crFormRow.version + 1])
    );
    values.Version = isPlaceholderValue(verRaw) ? "" : verRaw;

    // Extract CR cover metadata table
    for (const table of tables) {
      const labels = wordChildren(table, "tr").flatMap((row) =>
        wordChildren(row, "tc")
          .slice(0, -1)
          .map((cell) =>
            normalizeText(visibleWordText(cell)).replace(/\s*:\s*$/, "")
          )
      );
      if (!labels.includes("title") || !labels.includes("source to wg")) {
        continue;
      }
      for (const row of wordChildren(table, "tr")) {
        const cells = wordChildren(row, "tc");
        for (let i = 0; i < cells.length - 1; i++) {
          const label = normalizeText(visibleWordText(cells[i])).replace(
            /\s*:\s*$/,
            ""
          );
          const val = cleanInline(visibleWordText(cells[i + 1]));
          if (label === "title" && !values.Title) values.Title = val;
          else if (label === "source to wg" && !values.Source)
            values.Source = val;
          else if (label === "release" && !values.Release) values.Release = val;
          else if (label === "category" && !values["CR category"]) {
            values["CR category"] = val;
          } else if (
            (label === "work item code" || label === "work item") &&
            !values["Related WIs"]
          ) {
            values["Related WIs"] = val;
          }
        }
      }
      break;
    }

    if (!values.Title && !values.Spec) {
      throw new LocalToolError("metadata");
    }
    return {
      id,
      fileName: file.name,
      kind: "cr",
      values,
      excluded: false,
    };
  }

  // 2. Ordinary technical proposal / pCR / LS cover extraction
  const applyField = (rawLabel: string, rawVal: string) => {
    const label = normalizeText(rawLabel).replace(/\s*:\s*$/, "");
    const val = cleanInline(rawVal);
    if (!val) return;
    if (label === "title" && !values.Title) values.Title = val;
    else if ((label === "source" || label === "from") && !values.Source) {
      values.Source = val;
    } else if (label === "agenda item" && !values["Agenda item"]) {
      values["Agenda item"] = val.split(/\s+/)[0];
    } else if (
      (label === "document for" || label === "for" || label === "response") &&
      !values.For
    ) {
      const forMatch = val.match(
        /\b(Agreement|Approval|Discussion|Decision|Information|Action)\b/i
      );
      if (forMatch) {
        values.For =
          forMatch[1][0].toUpperCase() + forMatch[1].slice(1).toLowerCase();
      }
    } else if (
      (label === "spec" || label === "specification") &&
      !values.Spec
    ) {
      values.Spec = normalizeSpec(val);
    } else if (label === "release" && !values.Release) {
      values.Release = val;
    } else if (
      (label === "work item" ||
        label === "work item code" ||
        label === "related wis") &&
      !values["Related WIs"]
    ) {
      values["Related WIs"] = val;
    } else if (label === "to" && !values.To) {
      values.To = val;
    } else if (label === "cc" && !values.Cc) {
      values.Cc = val;
    } else if (label === "reply to" && !values["Reply to"]) {
      values["Reply to"] = val;
    }
  };

  for (const node of cover) {
    if (node.localName === "p") {
      const match = visibleWordText(node).match(
        /^\s*(Title|Source|From|To|Cc|Reply to|Agenda item|Document for|For|Spec|Specification|Release|Work item(?: code)?|Related WIs)\s*:\s*(.*)$/i
      );
      if (match) applyField(match[1], match[2]);
    } else if (node.localName === "tbl") {
      for (const row of wordChildren(node, "tr")) {
        const cells = wordChildren(row, "tc");
        for (let i = 0; i < cells.length - 1; i++) {
          const label = cleanInline(visibleWordText(cells[i])).replace(
            /:\s*$/,
            ""
          );
          if (
            /^(Title|Source|From|To|Cc|Reply to|Agenda item|Document for|For|Spec|Specification|Release|Work item(?: code)?|Related WIs)$/i.test(
              label
            )
          ) {
            applyField(label, visibleWordText(cells[i + 1]));
          }
        }
      }
    }
  }

  const coverText = cover.map(visibleWordText).join("\n");
  const isLs =
    Boolean(values.To || values["Reply to"]) ||
    /\bliaison\s+statement\b/i.test(coverText);
  const isPcr = /\bpseudo[-\s]?cr\b/i.test(coverText);

  if (isLs) {
    values.Type = values["Reply to"] ? "LS out" : "LS out";
    values.For = values.For || "Action";
  } else if (isPcr) {
    values.Type = "pCR";
    values.For = values.For || "Agreement";
  } else {
    values.Type = "discussion";
    values.For = values.For || "Discussion";
  }

  if (!values.Title && !values.Source) {
    throw new LocalToolError("technical_template");
  }

  return {
    id,
    fileName: file.name,
    kind: isLs ? "ls" : "technical",
    values,
    excluded: false,
  };
}

const ALLOCATION_WIDTHS = [
  48, // Title
  18, // Source
  14, // Contact ID
  12, // Type
  14, // For
  14, // Agenda item
  16, // TDoc sort order within agenda item
  16, // Is revision of
  10, // Release
  12, // Spec
  12, // Version
  18, // Related WIs
  10, // CR
  12, // CR revision
  12, // CR category
  14, // TSG CR Pack
  14, // Reply to
  14, // To
  14, // Cc
  14, // Original LS
  14, // Reply in
];

/**
 * Export allocation rows into Template_Bulk_TDoc_Allocation.xlsx.
 * If user uploaded an official blank template .xlsx, fills rows directly into its first worksheet
 * preserving sheet name, header row, styles and column order; otherwise builds a fresh valid .xlsx.
 */
export function exportAllocationWorkbook(
  rows: readonly AllocationRowValues[],
  templateBytes?: Uint8Array | null
): FileBytes {
  if (!templateBytes) {
    return buildSimpleXlsx({
      sheetName: "TDoc_Allocation",
      headers: ALLOCATION_COLUMNS,
      rows: rows.map((row) => ALLOCATION_COLUMNS.map((col) => row[col] || "")),
      columnWidths: ALLOCATION_WIDTHS,
    });
  }

  // Fill into uploaded blank Template_Bulk_TDoc_Allocation.xlsx
  const entries = unpackZip(templateBytes);
  const workbook = parseXml(entries["xl/workbook.xml"], S_NS);
  const firstSheet = elementsNS(workbook, S_NS, "sheet")[0];
  if (!firstSheet) throw new LocalToolError("invalid_package");
  const rid = firstSheet.getAttributeNS(R_NS, "id") || "";
  const rels = parseXml(entries["xl/_rels/workbook.xml.rels"]);
  const rel = [...rels.documentElement.children].find(
    (r) => r.getAttribute("Id") === rid
  );
  const target = rel?.getAttribute("Target") || "";
  if (!target || rel?.getAttribute("TargetMode") === "External") {
    throw new LocalToolError("invalid_package");
  }
  const sheetPath = target.startsWith("/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, "")}`;
  const sheetDoc = parseXml(entries[sheetPath], S_NS);

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

  const cellText = (cell: Element): string => {
    if (cell.getAttribute("t") === "inlineStr") {
      return elementsNS(cell, S_NS, "t")
        .map((t) => t.textContent || "")
        .join("");
    }
    const raw = elementsNS(cell, S_NS, "v")[0]?.textContent || "";
    if (cell.getAttribute("t") === "s") return sharedStrings[Number(raw)] ?? "";
    return raw;
  };

  const sheetData = elementsNS(sheetDoc, S_NS, "sheetData")[0];
  if (!sheetData) throw new LocalToolError("invalid_package");
  const existingRows = elementsNS(sheetData, S_NS, "row");
  const headerRow =
    existingRows.find((r) =>
      elementsNS(r, S_NS, "c").some(
        (c) => normalizeText(cellText(c)) === "title"
      )
    ) || existingRows[0];
  if (!headerRow) throw new LocalToolError("missing_columns");

  const headerRowNum = Number(headerRow.getAttribute("r") || 1);
  const colToField = new Map<string, AllocationColumn>();
  const colStyle = new Map<string, string>();
  for (const c of elementsNS(headerRow, S_NS, "c")) {
    const col = (c.getAttribute("r") || "").replace(/\d+/g, "");
    const title = normalizeText(cellText(c));
    const matched = ALLOCATION_COLUMNS.find((h) => normalizeText(h) === title);
    if (col && matched) colToField.set(col, matched);
  }
  if (!colToField.size) throw new LocalToolError("missing_columns");

  // Capture body row cell styles if template has a sample row 2, then clear rows below header
  const firstBodyRow = existingRows.find(
    (r) => Number(r.getAttribute("r") || 0) > headerRowNum
  );
  if (firstBodyRow) {
    for (const c of elementsNS(firstBodyRow, S_NS, "c")) {
      const col = (c.getAttribute("r") || "").replace(/\d+/g, "");
      const style = c.getAttribute("s");
      if (col && style) colStyle.set(col, style);
    }
  }
  for (const r of existingRows) {
    if (Number(r.getAttribute("r") || 0) > headerRowNum) {
      r.remove();
    }
  }

  const orderedCols = [...colToField.entries()];
  rows.forEach((rowValues, index) => {
    const rowNumber = headerRowNum + 1 + index;
    const tr = sheetDoc.createElementNS(S_NS, "row");
    tr.setAttribute("r", String(rowNumber));
    for (const [colLetter, field] of orderedCols) {
      const value = rowValues[field] || "";
      const cell = sheetDoc.createElementNS(S_NS, "c");
      cell.setAttribute("r", `${colLetter}${rowNumber}`);
      const style = colStyle.get(colLetter);
      if (style) cell.setAttribute("s", style);
      if (value) {
        cell.setAttribute("t", "inlineStr");
        const isEl = sheetDoc.createElementNS(S_NS, "is");
        const tEl = sheetDoc.createElementNS(S_NS, "t");
        tEl.setAttributeNS(
          "http://www.w3.org/XML/1998/namespace",
          "xml:space",
          "preserve"
        );
        tEl.textContent = value;
        isEl.append(tEl);
        cell.append(isEl);
      }
      tr.append(cell);
    }
    sheetData.append(tr);
  });

  // Update dimension ref if present
  const dim = elementsNS(sheetDoc, S_NS, "dimension")[0];
  if (dim && orderedCols.length) {
    const lastCol = colIndexToLetters(Math.max(orderedCols.length - 1, 0));
    dim.setAttribute("ref", `A1:${lastCol}${headerRowNum + rows.length}`);
  }

  // Ensure inline XML is well-formed (remove calcChain if present since rows changed)
  delete entries["xl/calcChain.xml"];
  entries[sheetPath] = strToU8(
    new XMLSerializer().serializeToString(sheetDoc)
  ) as FileBytes;
  return zipSync(entries, { level: 6 }) as FileBytes;
}

export function previewCsvRow(row: AllocationRowValues): string {
  return ALLOCATION_COLUMNS.map((c) => escapeXml(row[c] || "")).join("\t");
}
