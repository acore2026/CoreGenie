import { zipSync, strFromU8, strToU8 } from "fflate";
import { LocalToolError } from "./proposalFill";
import { getDefaultCrTemplateBytes } from "./crTemplateData";
import {
  W_NS,
  XML_NS,
  cleanInline,
  elementsNS,
  normalizeText,
  parseXml,
  readFileBytes,
  readXlsxSheets,
  unpackZip,
  visibleParagraphText,
  visibleWordText,
  wordChildren,
} from "./ooxml";
import type { ExportFile, FileBytes } from "./types";

export type ImpactLevel = "major" | "minor" | "patch";
export type BodyStyleMode = "full_yaml" | "header_only";

export interface SourceCrImpact {
  tdoc: string;
  sourceSpec: string;
  sourceCr: string;
  category: string;
  impactLevel: ImpactLevel;
  impactPhrase: string;
  inferredFromCategory: boolean;
  sheetName: string;
  rowNumber: number;
}

export interface ImpactedApiDraft {
  yamlFile: string;
  apiName: string;
  clause: string;
  clauseHeading: string;
  currentApiVersion: string;
  targetApiVersion: string;
  copyrightYear: string;
  externalDocsDescription: string;
  yamlLines: string[];
  highestImpact: ImpactLevel;
  impacts: SourceCrImpact[];
  potentiallyMissingNotes: string[];
  baselineMatched: boolean;
}

export interface ApiUpdateCrDraft {
  id: string;
  spec: string;
  release: string;
  workItem: string;
  currentTsVersion: string;
  targetTsVersion: string;
  isDraftRelease: boolean;
  clausesAffected: string;
  apis: ImpactedApiDraft[];
  selected: boolean;
  baselineFileName: string;
}

export interface ApiImpactsWorkbookResult {
  fileName: string;
  sheetsRead: string[];
  sourceRowCount: number;
  drafts: ApiUpdateCrDraft[];
}

export interface BaselineApiBlock {
  clause: string;
  heading: string;
  title: string;
  yamlFileHint: string;
  apiVersion: string;
  copyrightYear: string;
  externalDocsDescription: string;
  tsVersionInExternalDocs: string;
  yamlLines: string[];
}

export interface BaselineSpecData {
  id: string;
  fileName: string;
  kind: "docx" | "yaml";
  spec: string;
  release: string;
  currentTsVersion: string;
  apis: BaselineApiBlock[];
}

export interface ApiCrGenerationConfig {
  meetingHeader: string;
  meetingLocationDate: string;
  tdocPlaceholder: string;
  sourceToWg: string;
  sourceToTsg: string;
  date: string;
  copyrightYear: string;
  bodyMode: BodyStyleMode;
  author: string;
}

const IMPACT_RANK: Record<ImpactLevel, number> = {
  patch: 1,
  minor: 2,
  major: 3,
};

export function higherImpact(a: ImpactLevel, b: ImpactLevel): ImpactLevel {
  return IMPACT_RANK[a] >= IMPACT_RANK[b] ? a : b;
}

export function normalizeSpecNumber(raw: string): string {
  const cleaned = cleanInline(raw).replace(/^3gpp\s+(?:ts|tr)\s+/i, "");
  const dotMatch = cleaned.match(/(\d{2}\.\d{3}(?:-\d+)?)/);
  if (dotMatch) return dotMatch[1];
  const compact = cleaned.match(/^(\d{2})(\d{3})$/);
  if (compact) return `${compact[1]}.${compact[2]}`;
  return cleaned;
}

export function normalizeReleaseLabel(raw: string): string {
  const cleaned = cleanInline(raw);
  const match = cleaned.match(/(?:rel(?:ease)?[-\s]*)?(\d{2})/i);
  return match ? `Rel-${match[1]}` : cleaned;
}

export function defaultWorkItemForRelease(release: string): string {
  const match = release.match(/(\d{2})/);
  return match ? `TEI${match[1]}` : "";
}

export function releaseNumber(release: string): number {
  const match = release.match(/(\d{2})/);
  return match ? Number(match[1]) : 0;
}

export function specFromYamlName(yamlFile: string): string {
  const match = yamlFile.match(/^TS(\d{2})\.?(\d{3})(?:[-_].*)?\.ya?ml$/i);
  if (match) return `${match[1]}.${match[2]}`;
  return "";
}

export function apiNameFromYamlName(yamlFile: string): string {
  return yamlFile
    .replace(/^TS\d{2}\.?\d{3}[_-]?/i, "")
    .replace(/\.ya?ml$/i, "")
    .trim();
}

export function computeNextTsVersion(currentTsVersion: string): string {
  const match = cleanInline(currentTsVersion).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return "";
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

/**
 * Implements 3GPP TS 29.501 subclause 4.3.1 OpenAPI version numbering:
 * - Active draft/unfrozen release (e.g. Rel-20):
 *   - Already "-alpha.N": increments N (or bumps MAJOR to (M+1).0.0-alpha.1 on breaking change).
 *   - No "-alpha": bumps MINOR (or MAJOR on breaking change) with ".0-alpha.1".
 * - Frozen release (e.g. Rel-17, Rel-18, Rel-19):
 *   - major -> (M+1).0.0, minor -> M.(m+1).0, patch -> M.m.(p+1).
 */
export function computeNextApiVersion(
  currentVersion: string,
  highestImpact: ImpactLevel,
  isDraftRelease: boolean
): string {
  const cleaned = cleanInline(currentVersion).replace(/^['"]|['"]$/g, "");
  if (!cleaned) return "";

  const alpha = cleaned.match(/^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/i);
  if (alpha) {
    const major = Number(alpha[1]);
    const minor = Number(alpha[2]);
    const patch = Number(alpha[3]);
    const alphaNum = Number(alpha[4]);
    if (highestImpact === "major" && (minor > 0 || patch > 0)) {
      return `${major + 1}.0.0-alpha.1`;
    }
    return `${major}.${minor}.${patch}-alpha.${alphaNum + 1}`;
  }

  const semver = cleaned.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!semver) return "";
  const major = Number(semver[1]);
  const minor = Number(semver[2]);
  const patch = Number(semver[3]);

  if (isDraftRelease) {
    if (highestImpact === "major") return `${major + 1}.0.0-alpha.1`;
    return `${major}.${minor + 1}.0-alpha.1`;
  }

  if (highestImpact === "major") return `${major + 1}.0.0`;
  if (highestImpact === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function classifyCommentLine(
  line: string
): { level: ImpactLevel; phrase: string } | null {
  const lower = line.toLowerCase();
  if (
    /backward[s]?[-\s]*incompatible|non[-\s]*backward[s]?[-\s]*compatible|not\s+backward[s]?[-\s]*compatible|breaking\s+change/.test(
      lower
    )
  ) {
    return { level: "major", phrase: "backward incompatible change" };
  }
  if (/backward[s]?[-\s]*compatible/.test(lower)) {
    if (/(?:new\s+)?feature|enhancement|addition|extension/.test(lower)) {
      const phrase = /new\s+feature/.test(lower)
        ? "backward compatible new feature"
        : "backward compatible feature";
      return { level: "minor", phrase };
    }
    if (/correction|fix|editorial|clarification/.test(lower)) {
      return { level: "patch", phrase: "backward compatible correction" };
    }
    return { level: "patch", phrase: "backward compatible change" };
  }
  return null;
}

function fallbackImpactForCategory(cat: string): {
  level: ImpactLevel;
  phrase: string;
} {
  const upper = cleanInline(cat).toUpperCase();
  if (upper === "B" || upper === "C") {
    return { level: "minor", phrase: "backward compatible feature" };
  }
  return { level: "patch", phrase: "backward compatible correction" };
}

function parseYamlList(raw: string): string[] {
  const matches = raw.match(/TS\d{2}\.?\d{3}[A-Za-z0-9_-]*\.ya?ml/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of matches) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parsePerYamlImpactsFromComments(comments: string): {
  byYaml: Map<string, { level: ImpactLevel; phrase: string }>;
  overall: { level: ImpactLevel; phrase: string } | null;
} {
  const byYaml = new Map<string, { level: ImpactLevel; phrase: string }>();
  let overall: { level: ImpactLevel; phrase: string } | null = null;
  let current: { level: ImpactLevel; phrase: string } | null = null;

  for (const rawLine of comments.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^forge\s+related\s+attachments/i.test(line)) {
      current = null;
      continue;
    }
    const classified = classifyCommentLine(line);
    if (classified) {
      current = classified;
      if (
        !overall ||
        IMPACT_RANK[classified.level] > IMPACT_RANK[overall.level]
      ) {
        overall = classified;
      }
    }
    const yamls = parseYamlList(line);
    if (yamls.length && current) {
      for (const y of yamls) {
        const key = y.toLowerCase();
        const prev = byYaml.get(key);
        if (!prev || IMPACT_RANK[current.level] > IMPACT_RANK[prev.level]) {
          byYaml.set(key, current);
        }
      }
    }
  }
  return { byYaml, overall };
}

/**
 * Parse API_impacts_TSGCT.xlsx into grouped (TargetSpec, Release) CR drafts.
 */
export async function readApiImpactsWorkbook(
  file: File
): Promise<ApiImpactsWorkbookResult> {
  const bytes = await readFileBytes(file, ".xlsx");
  const sheets = readXlsxSheets(bytes);
  if (!sheets.length) throw new LocalToolError("invalid_package");

  const draftsMap = new Map<
    string,
    {
      spec: string;
      release: string;
      apis: Map<
        string,
        {
          yamlFile: string;
          impacts: SourceCrImpact[];
          seenImpactKeys: Set<string>;
          potentiallyMissingNotes: Set<string>;
        }
      >;
    }
  >();

  const sheetsRead: string[] = [];
  let sourceRowCount = 0;

  for (const sheet of sheets) {
    const headerRow = sheet.rows.find((row) => {
      const vals = Object.values(row.cells).map(normalizeText);
      return (
        vals.some((v) => v === "api impacts" || v === "api impact") &&
        vals.some((v) => /^tdoc\b/.test(v) || /^spec\b/.test(v))
      );
    });
    if (!headerRow) continue;
    sheetsRead.push(sheet.name);

    const colOf = (matcher: (header: string) => boolean): string => {
      for (const [col, text] of Object.entries(headerRow.cells)) {
        if (matcher(normalizeText(text))) return col;
      }
      return "";
    };

    const tdocCol = colOf((h) => /^tdoc\b/.test(h));
    const specCol = colOf((h) => /^spec\b/.test(h));
    const crCol = colOf((h) => /^cr\b/.test(h) && !h.includes("rev"));
    const relCol = colOf((h) => h === "release" || h === "rel");
    const catCol = colOf(
      (h) => h === "cat" || h === "category" || h === "cr category"
    );
    const impactsCol = colOf((h) => h === "api impacts" || h === "api impact");
    const missingCol = colOf((h) => h.includes("potentially missing"));
    const commentsCol = colOf(
      (h) => h.includes("other comments") || h === "comments"
    );

    for (const row of sheet.rows) {
      if (row.rowNumber <= headerRow.rowNumber) continue;
      const tdoc = cleanInline(row.cells[tdocCol] || "");
      const sourceSpec = normalizeSpecNumber(row.cells[specCol] || "");
      const sourceCr = cleanInline(row.cells[crCol] || "").replace(/^#/, "");
      const release = normalizeReleaseLabel(row.cells[relCol] || "");
      const category = cleanInline(row.cells[catCol] || "");
      const impactsRaw = row.cells[impactsCol] || "";
      const missingRaw = cleanInline(row.cells[missingCol] || "");
      const commentsRaw = row.cells[commentsCol] || "";

      const yamlFiles = parseYamlList(impactsRaw);
      if (!yamlFiles.length) continue;
      sourceRowCount += 1;

      const parsedComments = parsePerYamlImpactsFromComments(commentsRaw);
      const fallback = fallbackImpactForCategory(category);

      for (const yamlFile of yamlFiles) {
        const targetSpec = specFromYamlName(yamlFile) || sourceSpec;
        if (!targetSpec || !release) continue;

        const groupKey = `${targetSpec}::${release}`;
        let group = draftsMap.get(groupKey);
        if (!group) {
          group = { spec: targetSpec, release, apis: new Map() };
          draftsMap.set(groupKey, group);
        }

        const yamlKey = yamlFile.toLowerCase();
        let apiEntry = group.apis.get(yamlKey);
        if (!apiEntry) {
          apiEntry = {
            yamlFile,
            impacts: [],
            seenImpactKeys: new Set(),
            potentiallyMissingNotes: new Set(),
          };
          group.apis.set(yamlKey, apiEntry);
        }

        const matchedImpact =
          parsedComments.byYaml.get(yamlKey) || parsedComments.overall;
        const level = matchedImpact?.level ?? fallback.level;
        const phrase = matchedImpact?.phrase ?? fallback.phrase;
        const inferredFromCategory = !matchedImpact;

        const dedupeKey =
          `${sourceSpec}|${sourceCr}|${tdoc}|${phrase}`.toLowerCase();
        if (!apiEntry.seenImpactKeys.has(dedupeKey)) {
          apiEntry.seenImpactKeys.add(dedupeKey);
          apiEntry.impacts.push({
            tdoc,
            sourceSpec,
            sourceCr,
            category,
            impactLevel: level,
            impactPhrase: phrase,
            inferredFromCategory,
            sheetName: sheet.name,
            rowNumber: row.rowNumber,
          });
        }
        if (missingRaw) {
          apiEntry.potentiallyMissingNotes.add(missingRaw);
        }
      }
    }
  }

  if (!sheetsRead.length) {
    throw new LocalToolError("api_impacts_columns");
  }
  if (!draftsMap.size) {
    throw new LocalToolError("api_impacts_empty");
  }

  const drafts: ApiUpdateCrDraft[] = [...draftsMap.values()]
    .sort((a, b) =>
      a.spec === b.spec
        ? a.release.localeCompare(b.release)
        : a.spec.localeCompare(b.spec)
    )
    .map((group) => {
      const isDraftRelease = releaseNumber(group.release) >= 20;
      const apis: ImpactedApiDraft[] = [...group.apis.values()]
        .sort((a, b) => a.yamlFile.localeCompare(b.yamlFile))
        .map((entry) => {
          const highestImpact = entry.impacts.reduce<ImpactLevel>(
            (acc, item) => higherImpact(acc, item.impactLevel),
            "patch"
          );
          return {
            yamlFile: entry.yamlFile,
            apiName: apiNameFromYamlName(entry.yamlFile),
            clause: "",
            clauseHeading: "",
            currentApiVersion: "",
            targetApiVersion: "",
            copyrightYear: "",
            externalDocsDescription: "",
            yamlLines: [],
            highestImpact,
            impacts: entry.impacts,
            potentiallyMissingNotes: [...entry.potentiallyMissingNotes],
            baselineMatched: false,
          };
        });
      return {
        id: `${group.spec}__${group.release}`,
        spec: group.spec,
        release: group.release,
        workItem: defaultWorkItemForRelease(group.release),
        currentTsVersion: "",
        targetTsVersion: "",
        isDraftRelease,
        clausesAffected: "",
        apis,
        selected: true,
        baselineFileName: "",
      };
    });

  return {
    fileName: file.name,
    sheetsRead,
    sourceRowCount,
    drafts,
  };
}

/**
 * Parse a 3GPP specification version string from filename (e.g. 29574-k10.docx -> 20.1.0, 29522-ib0 -> 18.11.0).
 */
export function parse3gppVersionFromFilename(fileName: string): {
  spec: string;
  version: string;
  release: string;
} {
  const match = fileName.match(
    /(?:draft[-_]|stable[-_])?(\d{2})\.?(\d{3})[-_]([0-9a-z])([0-9a-z])([0-9a-z])/i
  );
  if (!match) return { spec: "", version: "", release: "" };
  const decode = (ch: string): number => {
    const lower = ch.toLowerCase();
    if (lower >= "0" && lower <= "9") return Number(lower);
    return 10 + (lower.charCodeAt(0) - "a".charCodeAt(0));
  };
  const major = decode(match[3]);
  const minor = decode(match[4]);
  const editorial = decode(match[5]);
  return {
    spec: `${match[1]}.${match[2]}`,
    version: `${major}.${minor}.${editorial}`,
    release: major >= 8 ? `Rel-${major}` : "",
  };
}

function extractYamlHeaderMetadata(lines: string[]): {
  title: string;
  apiVersion: string;
  copyrightYear: string;
  externalDocsDescription: string;
  tsVersionInExternalDocs: string;
} {
  let inInfo = false;
  let inExternalDocs = false;
  let title = "";
  let apiVersion = "";
  let copyrightYear = "";
  let externalDocsDescription = "";
  let capturingExtDesc = false;

  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^info\s*:/i.test(trimmed)) {
      inInfo = true;
      inExternalDocs = false;
      capturingExtDesc = false;
      continue;
    }
    if (/^externalDocs\s*:/i.test(trimmed)) {
      inInfo = false;
      inExternalDocs = true;
      capturingExtDesc = false;
      continue;
    }
    if (/^[a-zA-Z0-9_-]+\s*:/.test(line) && !/^\s/.test(line)) {
      inInfo = false;
      inExternalDocs = false;
      capturingExtDesc = false;
      continue;
    }

    if (inInfo) {
      const vMatch = trimmed.match(/^version\s*:\s*['"]?([^'"]+)['"]?$/i);
      if (vMatch && !apiVersion) apiVersion = vMatch[1].trim();
      const tMatch = trimmed.match(/^title\s*:\s*['"]?([^'"]+)['"]?$/i);
      if (tMatch && !title) title = tMatch[1].trim();
      const cMatch = trimmed.match(/©\s*(20\d{2})/);
      if (cMatch && !copyrightYear) copyrightYear = cMatch[1];
    }

    if (inExternalDocs) {
      if (capturingExtDesc) {
        if (/^\s{4,}/.test(line) && !/^url\s*:/i.test(trimmed)) {
          externalDocsDescription = cleanInline(
            `${externalDocsDescription} ${trimmed}`
          );
          continue;
        }
        capturingExtDesc = false;
      }
      const dMatch = trimmed.match(/^description\s*:\s*(.*)$/i);
      if (dMatch) {
        const rest = dMatch[1].trim();
        if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
          capturingExtDesc = true;
        } else {
          externalDocsDescription = rest.replace(/^['"]|['"]$/g, "");
        }
      }
    }
  }

  const verMatch = externalDocsDescription.match(
    /(?:V|version\s*)(\d+\.\d+\.\d+)/i
  );
  return {
    title,
    apiVersion,
    copyrightYear,
    externalDocsDescription,
    tsVersionInExternalDocs: verMatch ? verMatch[1] : "",
  };
}

/**
 * Parse a baseline 3GPP TS .docx or standalone .yaml file to extract Annex clauses and OpenAPI YAML blocks.
 */
export async function readBaselineSpec(file: File): Promise<BaselineSpecData> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".yaml") || lowerName.endsWith(".yml")) {
    const bytes = await readFileBytes(file);
    const content = strFromU8(bytes);
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const meta = extractYamlHeaderMetadata(lines);
    const spec = specFromYamlName(file.name);
    const majorMatch = meta.tsVersionInExternalDocs.match(/^(\d+)\./);
    return {
      id: `baseline-${file.name}-${file.size}`,
      fileName: file.name,
      kind: "yaml",
      spec,
      release: majorMatch ? `Rel-${majorMatch[1]}` : "",
      currentTsVersion: meta.tsVersionInExternalDocs,
      apis: [
        {
          clause: "",
          heading: meta.title || apiNameFromYamlName(file.name),
          title: meta.title,
          yamlFileHint: file.name,
          apiVersion: meta.apiVersion,
          copyrightYear: meta.copyrightYear,
          externalDocsDescription: meta.externalDocsDescription,
          tsVersionInExternalDocs: meta.tsVersionInExternalDocs,
          yamlLines: lines,
        },
      ],
    };
  }

  const bytes = await readFileBytes(file, ".docx");
  const entries = unpackZip(bytes);
  const doc = parseXml(entries["word/document.xml"], W_NS);
  const body = elementsNS(doc, W_NS, "body")[0];
  if (!body) throw new LocalToolError("invalid_package");

  const fromName = parse3gppVersionFromFilename(file.name);
  let spec = fromName.spec;
  let currentTsVersion = fromName.version;
  let release = fromName.release;

  const paragraphs = elementsNS(body, W_NS, "p").map((p) =>
    visibleParagraphText(p)
  );

  // Inspect cover paragraphs for 3GPP TS xx.xxx Vxx.x.x
  for (const line of paragraphs.slice(0, 60)) {
    const coverMatch = line.match(
      /3GPP\s+TS\s+(\d{2}\.\d{3})\s+V(\d+\.\d+\.\d+)/i
    );
    if (coverMatch) {
      spec = spec || coverMatch[1];
      currentTsVersion = currentTsVersion || coverMatch[2];
      const major = Number(coverMatch[2].split(".")[0]);
      if (!release && major >= 8) release = `Rel-${major}`;
      break;
    }
  }

  // Scan Annex A.x OpenAPI YAML sections
  const apis: BaselineApiBlock[] = [];
  let currentClause = "";
  let currentHeading = "";
  let currentYamlHint = "";
  let capturing = false;
  let currentYaml: string[] = [];

  const flushYaml = () => {
    if (!capturing || !currentYaml.length) return;
    while (currentYaml.length && !currentYaml[currentYaml.length - 1].trim()) {
      currentYaml.pop();
    }
    const meta = extractYamlHeaderMetadata(currentYaml);
    apis.push({
      clause: currentClause,
      heading: currentHeading,
      title: meta.title,
      yamlFileHint: currentYamlHint,
      apiVersion: meta.apiVersion,
      copyrightYear: meta.copyrightYear,
      externalDocsDescription: meta.externalDocsDescription,
      tsVersionInExternalDocs: meta.tsVersionInExternalDocs,
      yamlLines: [...currentYaml],
    });
    capturing = false;
    currentYaml = [];
  };

  for (const rawLine of paragraphs) {
    const trimmed = rawLine.trim();
    const annexMatch = trimmed.match(/^(A\.\d+(?:\.\d+)?)\s+(.+)$/);
    const otherAnnex = /^Annex\s+[B-Z]\b/i.test(trimmed);

    if (otherAnnex) {
      flushYaml();
      currentClause = "";
      currentHeading = "";
      currentYamlHint = "";
      continue;
    }

    if (
      annexMatch &&
      !/^[-#]/.test(trimmed) &&
      !trimmed.includes("$ref:") &&
      trimmed.length < 160
    ) {
      flushYaml();
      currentClause = annexMatch[1];
      currentHeading = cleanInline(annexMatch[2]);
      currentYamlHint = "";
      continue;
    }

    if (!capturing) {
      const hintMatch = trimmed.match(
        /(TS\d{2}\.?\d{3}[A-Za-z0-9_-]*\.ya?ml)/i
      );
      if (hintMatch) {
        currentYamlHint = hintMatch[1];
      }
      if (/^openapi\s*:\s*3\./i.test(trimmed)) {
        capturing = true;
        currentYaml = [rawLine.replace(/\t/g, "  ")];
      }
      continue;
    }

    // Stop YAML capture on CR markers or new non-YAML section headings
    if (
      /^={5,}|^\*{5,}/.test(trimmed) ||
      /^Annex\s+[A-Z]\b/i.test(trimmed) ||
      (/^[A-Z]\.\d+\s+/.test(trimmed) && !trimmed.startsWith("#"))
    ) {
      flushYaml();
      if (annexMatch) {
        currentClause = annexMatch[1];
        currentHeading = cleanInline(annexMatch[2]);
        currentYamlHint = "";
      }
      continue;
    }

    currentYaml.push(rawLine.replace(/\t/g, "  "));
  }
  flushYaml();

  if (!spec && apis[0]?.externalDocsDescription) {
    const m = apis[0].externalDocsDescription.match(/TS\s+(\d{2}\.\d{3})/i);
    if (m) spec = m[1];
  }
  if (!release && currentTsVersion) {
    const major = Number(currentTsVersion.split(".")[0]);
    if (major >= 8) release = `Rel-${major}`;
  }

  return {
    id: `baseline-${file.name}-${file.size}`,
    fileName: file.name,
    kind: "docx",
    spec,
    release,
    currentTsVersion,
    apis,
  };
}

function canonicalApiKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^3gpp[-_]/, "")
    .replace(/\bapi\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findMatchingBaselineApi(
  api: ImpactedApiDraft,
  blocks: BaselineApiBlock[]
): BaselineApiBlock | undefined {
  const yamlLower = api.yamlFile.toLowerCase();
  const byFile = blocks.find((b) => b.yamlFileHint.toLowerCase() === yamlLower);
  if (byFile) return byFile;

  const targetKey = canonicalApiKey(api.apiName);
  return blocks.find((b) => {
    const keys = [
      canonicalApiKey(b.title),
      canonicalApiKey(b.heading),
      canonicalApiKey(apiNameFromYamlName(b.yamlFileHint)),
    ].filter(Boolean);
    return keys.some(
      (k) => k === targetKey || k.includes(targetKey) || targetKey.includes(k)
    );
  });
}

function sortClauses(clauses: string[]): string[] {
  return [...clauses].sort((a, b) => {
    const partsA = a
      .replace(/^[A-Z]\./i, "")
      .split(".")
      .map(Number);
    const partsB = b
      .replace(/^[A-Z]\./i, "")
      .split(".")
      .map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) return diff;
    }
    return a.localeCompare(b);
  });
}

/**
 * Apply uploaded baseline TS .docx / .yaml files onto parsed CR drafts.
 */
export function applyBaselinesToDrafts(
  drafts: ApiUpdateCrDraft[],
  baselines: BaselineSpecData[]
): ApiUpdateCrDraft[] {
  return drafts.map((draft) => {
    const matchingBaselines = baselines.filter((b) => {
      if (b.spec && b.spec !== draft.spec) return false;
      if (b.release && b.release !== draft.release) return false;
      return true;
    });
    if (!matchingBaselines.length) return draft;

    const allBlocks = matchingBaselines.flatMap((b) => b.apis);
    const docxBaseline = matchingBaselines.find((b) => b.kind === "docx");
    const currentTsVersion =
      docxBaseline?.currentTsVersion ||
      draft.currentTsVersion ||
      matchingBaselines.find((b) => b.currentTsVersion)?.currentTsVersion ||
      "";
    const targetTsVersion =
      computeNextTsVersion(currentTsVersion) || draft.targetTsVersion;

    const updatedApis = draft.apis.map((api) => {
      const block = findMatchingBaselineApi(api, allBlocks);
      if (!block) return api;
      const isAlpha =
        draft.isDraftRelease || /-alpha\.\d+$/i.test(block.apiVersion);
      const targetApiVersion =
        computeNextApiVersion(block.apiVersion, api.highestImpact, isAlpha) ||
        api.targetApiVersion;
      return {
        ...api,
        clause: block.clause || api.clause,
        clauseHeading: block.heading || api.clauseHeading,
        currentApiVersion: block.apiVersion || api.currentApiVersion,
        targetApiVersion,
        copyrightYear: block.copyrightYear || api.copyrightYear,
        externalDocsDescription:
          block.externalDocsDescription || api.externalDocsDescription,
        yamlLines: block.yamlLines.length ? block.yamlLines : api.yamlLines,
        baselineMatched: true,
      };
    });

    const orderedApis = [...updatedApis].sort((a, b) => {
      if (a.clause && b.clause) {
        return sortClauses([a.clause, b.clause])[0] === a.clause ? -1 : 1;
      }
      return a.yamlFile.localeCompare(b.yamlFile);
    });

    const clauses = sortClauses([
      ...new Set(orderedApis.map((a) => a.clause).filter(Boolean)),
    ]).join(", ");

    return {
      ...draft,
      currentTsVersion,
      targetTsVersion,
      clausesAffected: clauses || draft.clausesAffected,
      apis: orderedApis,
      baselineFileName:
        docxBaseline?.fileName ||
        matchingBaselines.map((b) => b.fileName).join(", "),
    };
  });
}

/**
 * Build the Reason for change paragraphs following C3-265629.docx phrasing.
 */
export function buildReasonForChangeParagraphs(
  draft: ApiUpdateCrDraft
): string[] {
  const apiNames = draft.apis.map((a) => a.apiName);
  const apiListText =
    apiNames.length <= 1
      ? `${apiNames[0] || "the impacted"} API`
      : apiNames.length === 2
        ? `${apiNames[0]} and ${apiNames[1]} APIs`
        : `${apiNames.slice(0, -1).join(", ")} and ${apiNames[apiNames.length - 1]} APIs`;

  const lines: string[] = [
    `CRs modifying ${apiListText} have been agreed and the version number of the corresponding OpenAPI file thus needs to be incremented following the rules in TS 29.501, subclause 4.3.1.`,
  ];

  for (const api of draft.apis) {
    const clauseNote = api.clause ? ` in ${api.clause}` : "";
    lines.push(
      `The following agreed CRs update the OpenAPI file of the ${api.apiName} API${clauseNote} for the present release:`
    );
    for (const imp of api.impacts) {
      const crLabel = imp.sourceCr ? `CR#${imp.sourceCr}` : imp.tdoc;
      lines.push(`${imp.sourceSpec} ${crLabel} introduces ${imp.impactPhrase}`);
    }
    const oldVer = api.currentApiVersion || "x.y.z";
    const newVer = api.targetApiVersion || "x.y.z";
    lines.push(
      `The API version needs to be updated from ${oldVer} to ${newVer}.`
    );
    const targetVer = draft.targetTsVersion || "x.y.z";
    lines.push(
      `The "externalDocs" object description field also needs to be updated to "v${targetVer}" for this API.`
    );
  }

  return lines;
}

export function buildSummaryOfChange(
  draft: ApiUpdateCrDraft,
  targetCopyrightYear: string
): string {
  const needsCopyright = draft.apis.some(
    (a) => a.copyrightYear && a.copyrightYear !== targetCopyrightYear
  );
  return needsCopyright
    ? `Update the API version, the "externalDocs" object description field and the copyright year to ${targetCopyrightYear}.`
    : `Update the API version and the "externalDocs" object description field.`;
}

function appendDiffRuns(
  doc: Document,
  paragraph: Element,
  before: string,
  after: string,
  revState: { id: number; author: string; date: string }
): void {
  const makeRun = (text: string, isDel = false): Element => {
    const r = doc.createElementNS(W_NS, "w:r");
    const t = doc.createElementNS(W_NS, isDel ? "w:delText" : "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = text;
    r.append(t);
    return r;
  };

  if (before === after) {
    if (before) paragraph.append(makeRun(before));
    return;
  }

  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const left = before.slice(0, prefix);
  const delText = before.slice(prefix, before.length - suffix);
  const insText = after.slice(prefix, after.length - suffix);
  const right = suffix ? before.slice(before.length - suffix) : "";

  if (left) paragraph.append(makeRun(left));
  if (delText) {
    const del = doc.createElementNS(W_NS, "w:del");
    del.setAttributeNS(W_NS, "w:id", String(++revState.id));
    del.setAttributeNS(W_NS, "w:author", revState.author);
    del.setAttributeNS(W_NS, "w:date", revState.date);
    del.append(makeRun(delText, true));
    paragraph.append(del);
  }
  if (insText) {
    const ins = doc.createElementNS(W_NS, "w:ins");
    ins.setAttributeNS(W_NS, "w:id", String(++revState.id));
    ins.setAttributeNS(W_NS, "w:author", revState.author);
    ins.setAttributeNS(W_NS, "w:date", revState.date);
    ins.append(makeRun(insText, false));
    paragraph.append(ins);
  }
  if (right) paragraph.append(makeRun(right));
}

function makeStyledParagraph(
  doc: Document,
  styleId: string,
  text?: string
): Element {
  const p = doc.createElementNS(W_NS, "w:p");
  if (styleId) {
    const pPr = doc.createElementNS(W_NS, "w:pPr");
    const pStyle = doc.createElementNS(W_NS, "w:pStyle");
    pStyle.setAttributeNS(W_NS, "w:val", styleId);
    pPr.append(pStyle);
    p.append(pPr);
  }
  if (text) {
    const r = doc.createElementNS(W_NS, "w:r");
    const t = doc.createElementNS(W_NS, "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = text;
    r.append(t);
    p.append(r);
  }
  return p;
}

function buildApiYamlChangeNodes(
  doc: Document,
  api: ImpactedApiDraft,
  draft: ApiUpdateCrDraft,
  config: ApiCrGenerationConfig,
  styles: { headingStyleId: string; plStyleId: string },
  revState: { id: number; author: string; date: string }
): Element[] {
  const nodes: Element[] = [];

  // Annex heading paragraph (e.g. "A.2\tNdccf_DataManagement API")
  const headingP = makeStyledParagraph(doc, styles.headingStyleId);
  const headingTitle = api.clauseHeading || `${api.apiName} API`;
  if (api.clause) {
    const r1 = doc.createElementNS(W_NS, "w:r");
    const t1 = doc.createElementNS(W_NS, "w:t");
    t1.textContent = api.clause;
    r1.append(t1);
    const rTab = doc.createElementNS(W_NS, "w:r");
    rTab.append(doc.createElementNS(W_NS, "w:tab"));
    const r2 = doc.createElementNS(W_NS, "w:r");
    const t2 = doc.createElementNS(W_NS, "w:t");
    t2.setAttributeNS(XML_NS, "xml:space", "preserve");
    t2.textContent = headingTitle;
    r2.append(t2);
    headingP.append(r1, rTab, r2);
  } else {
    const r = doc.createElementNS(W_NS, "w:r");
    const t = doc.createElementNS(W_NS, "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = headingTitle;
    r.append(t);
    headingP.append(r);
  }
  nodes.push(headingP);

  const rawLines = api.yamlLines.length
    ? api.yamlLines
    : [
        "openapi: 3.0.0",
        "",
        "info:",
        `  version: ${api.currentApiVersion || "x.y.z"}`,
        `  title: ${api.apiName}`,
        "  description: |",
        `    ${api.apiName} Service.`,
        `    © ${api.copyrightYear || config.copyrightYear}, 3GPP Organizational Partners (ARIB, ATIS, CCSA, ETSI, TSDSI, TTA, TTC).`,
        "    All rights reserved.",
        "",
        "externalDocs:",
        `  description: 3GPP TS ${draft.spec} V${draft.currentTsVersion || "x.y.z"}; 5G System; Stage 3.`,
        `  url: 'https://www.3gpp.org/ftp/Specs/archive/${draft.spec.slice(0, 2)}_series/${draft.spec}/'`,
      ];

  let linesToRender = rawLines;
  let skippedTrailer = false;
  if (config.bodyMode === "header_only" && api.yamlLines.length) {
    const extIdx = rawLines.findIndex((l) =>
      /^externalDocs\s*:/i.test(l.trim())
    );
    if (extIdx >= 0) {
      let cut = Math.min(rawLines.length, extIdx + 5);
      for (
        let i = extIdx + 1;
        i < Math.min(rawLines.length, extIdx + 10);
        i++
      ) {
        if (/^url\s*:/i.test(rawLines[i].trim())) {
          cut = i + 1;
          break;
        }
      }
      linesToRender = rawLines.slice(0, cut);
      skippedTrailer = cut < rawLines.length;
    }
  } else if (!api.yamlLines.length) {
    skippedTrailer = true;
  }

  let inInfo = false;
  let inExternalDocs = false;
  let versionUpdated = false;
  let extVersionUpdated = false;

  for (const line of linesToRender) {
    const trimmed = line.trim();
    if (/^info\s*:/i.test(trimmed)) {
      inInfo = true;
      inExternalDocs = false;
    } else if (/^externalDocs\s*:/i.test(trimmed)) {
      inInfo = false;
      inExternalDocs = true;
    } else if (/^[a-zA-Z0-9_-]+\s*:/.test(line) && !/^\s/.test(line)) {
      inInfo = false;
      inExternalDocs = false;
    }

    let updatedLine = line;
    if (
      inInfo &&
      !versionUpdated &&
      api.targetApiVersion &&
      /^\s*version\s*:\s*/i.test(line)
    ) {
      const m = line.match(/^(\s*version\s*:\s*['"]?)([^'"]+)(['"]?\s*)$/i);
      if (m) {
        updatedLine = `${m[1]}${api.targetApiVersion}${m[3]}`;
        versionUpdated = true;
      }
    } else if (inInfo && config.copyrightYear && /©\s*20\d{2}/.test(line)) {
      updatedLine = line.replace(
        /(©\s*)(20\d{2})/,
        `$1${config.copyrightYear}`
      );
    } else if (
      inExternalDocs &&
      !extVersionUpdated &&
      draft.targetTsVersion &&
      /(?:V|version\s*)\d+\.\d+\.\d+/i.test(line)
    ) {
      updatedLine = line.replace(
        /((?:V|version\s*))(\d+\.\d+\.\d+)/i,
        `$1${draft.targetTsVersion}`
      );
      extVersionUpdated = true;
    }

    const p = makeStyledParagraph(doc, styles.plStyleId);
    appendDiffRuns(doc, p, line, updatedLine, revState);
    nodes.push(p);
  }

  if (skippedTrailer) {
    nodes.push(
      makeStyledParagraph(
        doc,
        styles.plStyleId,
        "*********** skipped for clarity ***********"
      )
    );
  }
  return nodes;
}

function setCellLinesPreservingStyle(
  doc: Document,
  cell: Element,
  lines: string[]
): void {
  const existingParagraphs = wordChildren(cell, "p");
  const sampleP = existingParagraphs[0];
  const samplePPr = sampleP ? wordChildren(sampleP, "pPr")[0] : undefined;
  const sampleR = sampleP ? wordChildren(sampleP, "r")[0] : undefined;
  const sampleRPr =
    (sampleR ? wordChildren(sampleR, "rPr")[0] : undefined) ||
    (samplePPr ? wordChildren(samplePPr, "rPr")[0] : undefined);

  for (const p of existingParagraphs) {
    p.remove();
  }

  const values = lines.length ? lines : [""];
  for (const text of values) {
    const p = doc.createElementNS(W_NS, "w:p");
    if (samplePPr) p.append(samplePPr.cloneNode(true));
    if (text) {
      const r = doc.createElementNS(W_NS, "w:r");
      if (sampleRPr) r.append(sampleRPr.cloneNode(true));
      const t = doc.createElementNS(W_NS, "w:t");
      t.setAttributeNS(XML_NS, "xml:space", "preserve");
      t.textContent = text;
      r.append(t);
      p.append(r);
    }
    cell.append(p);
  }
}

function resolveTemplateStyleIds(entries: Record<string, FileBytes>): {
  headingStyleId: string;
  plStyleId: string;
  separatorStyleId: string;
} {
  let headingStyleId = "Heading1";
  let plStyleId = "PL";
  let separatorStyleId = "CRSeparator";
  if (!entries["word/styles.xml"]) {
    return { headingStyleId, plStyleId, separatorStyleId };
  }
  const stylesDoc = parseXml(entries["word/styles.xml"], W_NS);
  for (const style of elementsNS(stylesDoc, W_NS, "style")) {
    const id = style.getAttributeNS(W_NS, "styleId") || "";
    const nameEl = wordChildren(style, "name")[0];
    const name = (nameEl?.getAttributeNS(W_NS, "val") || "").toLowerCase();
    if (name === "heading 1" && id) headingStyleId = id;
    if (name === "pl" && id) plStyleId = id;
    if ((name === "cr_separator" || name === "crseparator") && id) {
      separatorStyleId = id;
    }
  }
  return { headingStyleId, plStyleId, separatorStyleId };
}

/**
 * Generate a 3GPP CR-Form-v13.0.1 .docx directly on top of the official 3GPP
 * CR_template_CT3.docx (or a user-provided CR template .docx), preserving all
 * official 3GPP table borders, yellow cover shading, headers, fonts, and styles.
 * Fully compatible with both the Bulk TDoc Allocation exporter and proposalFill.ts.
 */
export function generateApiUpdateCrDocx(
  draft: ApiUpdateCrDraft,
  config: ApiCrGenerationConfig,
  customTemplateBytes?: Uint8Array | null
): FileBytes {
  const entries = unpackZip(customTemplateBytes ?? getDefaultCrTemplateBytes());
  const doc = parseXml(entries["word/document.xml"], W_NS);
  const body = elementsNS(doc, W_NS, "body")[0];
  if (!body) throw new LocalToolError("template");

  const styles = resolveTemplateStyleIds(entries);
  const isoDate = `${config.date || new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const revState = {
    id: 0,
    author: config.author || config.sourceToWg || "CoreGenie",
    date: isoDate,
  };

  // 1. Update cover meeting header and location/date paragraphs before Table 1
  const topParagraphs: Element[] = [];
  for (const child of [...body.children]) {
    if (child.localName === "tbl") break;
    if (child.localName === "p") topParagraphs.push(child);
  }
  if (topParagraphs[0]) {
    const p = topParagraphs[0];
    const pPr = wordChildren(p, "pPr")[0];
    const firstR = wordChildren(p, "r")[0];
    const sampleRPr =
      (firstR ? wordChildren(firstR, "rPr")[0] : undefined) ||
      (pPr ? wordChildren(pPr, "rPr")[0] : undefined);
    for (const child of [...p.children]) {
      if (child !== pPr) child.remove();
    }
    const rTitle = doc.createElementNS(W_NS, "w:r");
    if (sampleRPr) rTitle.append(sampleRPr.cloneNode(true));
    const tTitle = doc.createElementNS(W_NS, "w:t");
    tTitle.setAttributeNS(XML_NS, "xml:space", "preserve");
    tTitle.textContent = config.meetingHeader || "3GPP TSG-CT WG3 Meeting";
    rTitle.append(tTitle);
    p.append(rTitle);

    const rTab = doc.createElementNS(W_NS, "w:r");
    if (sampleRPr) rTab.append(sampleRPr.cloneNode(true));
    rTab.append(doc.createElementNS(W_NS, "w:tab"));
    p.append(rTab);

    if (config.tdocPlaceholder) {
      const rTdoc = doc.createElementNS(W_NS, "w:r");
      if (sampleRPr) rTdoc.append(sampleRPr.cloneNode(true));
      const tTdoc = doc.createElementNS(W_NS, "w:t");
      tTdoc.textContent = config.tdocPlaceholder;
      rTdoc.append(tTdoc);
      p.append(rTdoc);
    }
  }
  if (topParagraphs[1]) {
    const p = topParagraphs[1];
    const pPr = wordChildren(p, "pPr")[0];
    const firstR = wordChildren(p, "r")[0];
    const sampleRPr =
      (firstR ? wordChildren(firstR, "rPr")[0] : undefined) ||
      (pPr ? wordChildren(pPr, "rPr")[0] : undefined);
    for (const child of [...p.children]) {
      if (child !== pPr) child.remove();
    }
    if (config.meetingLocationDate) {
      const r = doc.createElementNS(W_NS, "w:r");
      if (sampleRPr) r.append(sampleRPr.cloneNode(true));
      const t = doc.createElementNS(W_NS, "w:t");
      t.setAttributeNS(XML_NS, "xml:space", "preserve");
      t.textContent = config.meetingLocationDate;
      r.append(t);
      p.append(r);
    }
  }

  // 2. Update Table 1 (Spec, CR, rev, Current version) and Table 3 (Cover metadata)
  const tables = wordChildren(body, "tbl");
  let formUpdated = false;
  let coverUpdated = false;
  const reasonParagraphs = buildReasonForChangeParagraphs(draft);
  const summaryText = buildSummaryOfChange(draft, config.copyrightYear);
  const consequencesText =
    'Incorrect API version number and incorrect TS version number in the "description" field of the "externalDocs" object.';

  for (const table of tables) {
    if (!formUpdated) {
      for (const row of wordChildren(table, "tr")) {
        const cells = wordChildren(row, "tc");
        const labels = cells.map((cell) =>
          normalizeText(visibleWordText(cell))
        );
        const cr = labels.indexOf("cr");
        const rev = labels.indexOf("rev");
        const version = labels.findIndex((v) =>
          /^current version\s*:?$/.test(v)
        );
        if (cr > 0 && rev > cr && version > rev && cells[version + 1]) {
          setCellLinesPreservingStyle(doc, cells[cr - 1], [draft.spec]);
          setCellLinesPreservingStyle(doc, cells[cr + 1], ["xxxx"]);
          setCellLinesPreservingStyle(doc, cells[rev + 1], ["-"]);
          setCellLinesPreservingStyle(doc, cells[version + 1], [
            draft.currentTsVersion,
          ]);
          formUpdated = true;
          break;
        }
      }
      if (formUpdated) continue;
    }

    if (!coverUpdated) {
      const allLabels = wordChildren(table, "tr").flatMap((row) =>
        wordChildren(row, "tc")
          .slice(0, -1)
          .map((cell) =>
            normalizeText(visibleWordText(cell)).replace(/\s*:\s*$/, "")
          )
      );
      if (allLabels.includes("title") && allLabels.includes("source to wg")) {
        for (const row of wordChildren(table, "tr")) {
          const cells = wordChildren(row, "tc");
          for (let i = 0; i < cells.length - 1; i++) {
            const label = normalizeText(visibleWordText(cells[i])).replace(
              /\s*:\s*$/,
              ""
            );
            if (label === "title") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [
                "Update of info and externalDocs fields",
              ]);
            } else if (label === "source to wg") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [
                config.sourceToWg || "",
              ]);
            } else if (label === "source to tsg") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [
                config.sourceToTsg || "C3",
              ]);
            } else if (label === "work item code" || label === "work item") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [draft.workItem]);
            } else if (label === "date") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [
                config.date || new Date().toISOString().slice(0, 10),
              ]);
            } else if (label === "category") {
              setCellLinesPreservingStyle(doc, cells[i + 1], ["F"]);
            } else if (label === "release") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [draft.release]);
            } else if (label === "reason for change") {
              setCellLinesPreservingStyle(doc, cells[i + 1], reasonParagraphs);
            } else if (label === "summary of change") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [summaryText]);
            } else if (label === "consequences if not approved") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [
                consequencesText,
              ]);
            } else if (label === "clauses affected") {
              setCellLinesPreservingStyle(doc, cells[i + 1], [
                draft.clausesAffected,
              ]);
            }
          }
        }
        coverUpdated = true;
      }
    }
  }

  if (!formUpdated || !coverUpdated) {
    throw new LocalToolError("template");
  }

  // 3. Replace placeholder body paragraphs after the cover page section break
  const bodyChildren = [...body.children];
  const finalSectPr =
    bodyChildren.at(-1)?.localName === "sectPr" ? bodyChildren.at(-1) : null;

  let bodyStartIdx = bodyChildren.findIndex(
    (node) =>
      node.localName === "p" && /first\s+change/i.test(visibleWordText(node))
  );
  if (bodyStartIdx < 0) {
    const coverBreakIdx = bodyChildren.findIndex(
      (node) =>
        node.localName === "p" && elementsNS(node, W_NS, "sectPr").length > 0
    );
    bodyStartIdx =
      coverBreakIdx >= 0
        ? coverBreakIdx + 1
        : bodyChildren.length - (finalSectPr ? 1 : 0);
  }

  const templateSeparatorP = bodyChildren[bodyStartIdx];
  const templateSeparatorPPr =
    templateSeparatorP?.localName === "p"
      ? wordChildren(templateSeparatorP, "pPr")[0]
      : undefined;

  for (let i = bodyStartIdx; i < bodyChildren.length; i++) {
    if (bodyChildren[i] !== finalSectPr) {
      bodyChildren[i].remove();
    }
  }

  const makeSeparatorP = (label: string): Element => {
    const p = doc.createElementNS(W_NS, "w:p");
    if (templateSeparatorPPr) {
      p.append(templateSeparatorPPr.cloneNode(true));
    } else {
      const pPr = doc.createElementNS(W_NS, "w:pPr");
      const pStyle = doc.createElementNS(W_NS, "w:pStyle");
      pStyle.setAttributeNS(W_NS, "w:val", styles.separatorStyleId);
      pPr.append(pStyle);
      p.append(pPr);
    }
    const r = doc.createElementNS(W_NS, "w:r");
    const t = doc.createElementNS(W_NS, "w:t");
    t.textContent = label;
    r.append(t);
    p.append(r);
    return p;
  };

  const insertNode = (node: Element) => {
    if (finalSectPr) body.insertBefore(node, finalSectPr);
    else body.append(node);
  };

  draft.apis.forEach((api, idx) => {
    insertNode(
      makeSeparatorP(
        idx === 0
          ? "==============First change=============="
          : "==============Next change=============="
      )
    );
    const changeNodes = buildApiYamlChangeNodes(
      doc,
      api,
      draft,
      config,
      styles,
      revState
    );
    for (const node of changeNodes) {
      insertNode(node);
    }
  });
  insertNode(makeSeparatorP("==============End of change=============="));

  // 4. Enable trackRevisions in word/settings.xml so Word renders change marks cleanly
  if (entries["word/settings.xml"]) {
    const settingsDoc = parseXml(entries["word/settings.xml"], W_NS);
    if (!elementsNS(settingsDoc, W_NS, "trackRevisions").length) {
      settingsDoc.documentElement.append(
        settingsDoc.createElementNS(W_NS, "w:trackRevisions")
      );
      entries["word/settings.xml"] = strToU8(
        new XMLSerializer().serializeToString(settingsDoc)
      ) as FileBytes;
    }
  }

  entries["word/document.xml"] = strToU8(
    new XMLSerializer().serializeToString(doc)
  ) as FileBytes;
  return zipSync(entries, { level: 6 }) as FileBytes;
}

export function crOutputFilename(
  draft: ApiUpdateCrDraft,
  tdocPlaceholder: string
): string {
  const prefix = cleanInline(tdocPlaceholder) || "CR";
  return `${prefix}_${draft.spec}_${draft.release}_Update_of_info_and_externalDocs.docx`
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_");
}

export function packageGeneratedCrs(
  files: ExportFile[],
  report: readonly unknown[]
): FileBytes {
  const entries: Record<string, FileBytes> = Object.create(null);
  for (const item of files) {
    entries[item.name] = item.bytes;
  }
  entries["生成清单.json"] = strToU8(
    JSON.stringify(report, null, 2)
  ) as FileBytes;
  return zipSync(entries, { level: 0 }) as FileBytes;
}
