import i18n from "@/i18n";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

export const controlClass =
  "min-h-[40px] max-w-full rounded-md border border-theme-sidebar-border bg-theme-bg-chat px-3 py-2 text-sm text-theme-text-primary transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";

export const primaryButtonClass =
  "min-h-[40px] max-w-full rounded-md border border-primary-button bg-primary-button px-3.5 py-2 text-sm font-medium !text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";

export const inputClass =
  "min-h-[40px] w-full rounded-md border border-theme-sidebar-border bg-theme-bg-chat px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50";

export function authHeaders(extra: Record<string, string> = {}) {
  const base = Object.fromEntries(
    Object.entries(baseHeaders()).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
  return { ...base, ...extra };
}

export function formatBytes(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function tr(key: string, params?: Record<string, unknown>) {
  return String(i18n.t("local_tools.docAssistant." + key, params));
}

export interface ConvertProgress {
  stage: "queued" | "downloading" | "converting" | "writing_pdf" | "finalizing";
  queuePosition?: number;
  elapsedMs: number;
  stageElapsedMs?: number;
  timeoutMs?: number;
  wordBytes?: number;
  downloadedBytes?: number;
  downloadTotalBytes?: number;
  pdfBytes?: number;
}

export interface DocZipMember {
  name: string;
  size: number;
  compressedSize: number;
  isWord: boolean;
  isPdf?: boolean;
  convertible: boolean;
  reason?: string;
  hash: string;
  filename: string;
  status:
    | "idle"
    | "queued"
    | "downloading"
    | "converting"
    | "ready"
    | "failed"
    | "unsupported"
    | "pdf";
  cached: boolean;
  pdfPath?: string;
  pdfSize?: number;
  progress?: ConvertProgress;
  error?: string;
}

export interface TdocLookupResult {
  kind: "tdoc" | "workshop";
  id: string;
  wgKey: string;
  wgPath: string;
  meetingFolder: string;
  meetingNumber?: number | null;
  subfolder?: string;
  sourceId: string;
  sourceLabel: string;
  relPath: string;
  zipName: string;
  zipUrl: string;
  dirUrl?: string;
  totalSize?: number;
  members: DocZipMember[];
  searchedCount?: number;
  warning?: string;
}

export interface RfcLookupResult {
  kind: "rfc";
  id: string;
  number: string;
  sourceLabel: string;
  txtUrl: string;
  htmlUrl: string;
  localUrl?: string;
  pdfUrl: string;
  datatrackerUrl: string;
}

export interface DraftLookupResult {
  kind: "ietf-draft";
  id: string;
  sourceLabel: string;
  txtUrl: string;
  datatrackerUrl: string;
}

export interface AssistantConfig {
  groups: string[];
  sources: {
    hasLocalMirror: boolean;
    hasHttpMirror: boolean;
    summary: string;
  };
  maxBatchItems: number;
}

export interface MeetingItem {
  id: string;
  number: number;
  label: string;
  url: string;
  relPath: string;
}

export interface AgendaFileItem {
  mirrored?: boolean;
  name: string;
  url: string;
  relPath: string;
  date?: string;
  size?: string;
  sourceLabel: string;
  isWord: boolean;
  isHtml: boolean;
  isPdf: boolean;
  isZip: boolean;
  convertible: boolean;
  status:
    | "idle"
    | "queued"
    | "downloading"
    | "converting"
    | "ready"
    | "failed"
    | "pdf";
  cached: boolean;
  pdfPath?: string;
  pdfSize?: number;
  progress?: ConvertProgress;
  error?: string;
}

export interface AgendaResponse {
  group: string;
  meetingFolder: string;
  meetingNumber: number;
  meetingUrl: string;
  sourceLabel: string;
  agenda: AgendaFileItem[];
  chairNotes: AgendaFileItem[];
  reports: AgendaFileItem[];
}

export interface CrItem {
  tdoc: string;
  spec: string;
  cr: string;
  revision: string;
  title: string;
  release: string;
  meeting: string;
  wgStatus: string;
  tsgStatus: string;
  withdrawn: boolean;
}

export interface CrSearchResponse {
  items: CrItem[];
  totalFound: number;
  withdrawnCount: number;
  page: number;
  hasMore: boolean;
  portalUrl: string;
}

export interface BatchFileItem {
  name: string;
  url: string;
  relPath?: string;
  subfolder?: string;
  date?: string;
  size?: string;
  isTdoc: boolean;
}

export function isWorkingStatus(status: string) {
  return (
    status === "queued" || status === "downloading" || status === "converting"
  );
}

async function jsonRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: authHeaders(
      (init.headers as Record<string, string> | undefined) || {}
    ),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || tr("failed"));
  }
  return data as T;
}

export function fetchAssistantConfig(signal?: AbortSignal) {
  return jsonRequest<AssistantConfig>("/3gpp/doc-assistant/config", { signal });
}

interface Entry {
  mirrored?: boolean;
  version: string;
  date?: string;
  source?: "etsi" | "3gpp";
  zipUrl?: string;
  zipName?: string;
  zipSize?: string;
}

interface SubSpec {
  id: string;
  type: string;
  group?: string;
  title?: string;
  kiCount?: number;
}

export interface SpecResult {
  type: string;
  id: string;
  title?: string;
  dir?: string;
  archiveDir?: string;
  sources?: { etsi: boolean; threeGpp: boolean };
  subSpecs?: SubSpec[];
  requested?: string;
  warning?: string;
  index: { entries: Entry[]; checked: string };
}

export type LookupResult =
  | { kind: "spec"; specResult: SpecResult }
  | TdocLookupResult
  | RfcLookupResult
  | DraftLookupResult;

export async function lookupUnifiedDoc(
  params: { q: string; hint: string; refresh: string },
  signal: AbortSignal,
  onProgress: (value: string) => void
): Promise<LookupResult> {
  const response = await fetch(
    API_BASE + "/3gpp/doc-assistant/lookup?" + new URLSearchParams(params),
    {
      headers: authHeaders({ Accept: "application/x-ndjson" }),
      signal,
    }
  );
  if (!response.ok)
    throw new Error((await response.json()).error || tr("failed"));
  if (!response.body) throw new Error(tr("unavailable"));
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (event.result) return event.result;
        if (event.progress) onProgress(tr("searching", event.progress));
      }
    }
    throw new Error(tr("unavailable"));
  } finally {
    reader.releaseLock();
  }
}

export function fetchWgMeetings(
  group: string,
  refresh = false,
  signal?: AbortSignal
) {
  const qs = new URLSearchParams({ group, refresh: refresh ? "1" : "0" });
  return jsonRequest<{
    group: string;
    sourceLabel: string;
    meetings: MeetingItem[];
  }>("/3gpp/doc-assistant/meetings?" + qs.toString(), { signal });
}

export function fetchAgendaAndNotes(
  params: { group: string; meeting: string; chair?: string },
  signal?: AbortSignal
) {
  const qs = new URLSearchParams({
    group: params.group,
    meeting: params.meeting,
  });
  if (params.chair) qs.set("chair", params.chair);
  return jsonRequest<AgendaResponse>(
    "/3gpp/doc-assistant/agenda?" + qs.toString(),
    { signal }
  );
}

export function searchChangeRequestsApi(
  params: {
    spec?: string;
    release?: string;
    wgStatus?: string;
    tsgStatus?: string;
    meeting?: string;
    workItem?: string;
    includeWithdrawn?: boolean;
    page?: number;
  },
  signal?: AbortSignal
) {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.spec) qs.set("spec", params.spec);
  if (params.release) qs.set("release", params.release);
  if (params.wgStatus) qs.set("wgStatus", params.wgStatus);
  if (params.tsgStatus) qs.set("tsgStatus", params.tsgStatus);
  if (params.meeting) qs.set("meeting", params.meeting);
  if (params.workItem) qs.set("workItem", params.workItem);
  if (params.includeWithdrawn) qs.set("includeWithdrawn", "1");
  return jsonRequest<CrSearchResponse>(
    "/3gpp/doc-assistant/cr-search?" + qs.toString(),
    { signal }
  );
}

export function fetchBatchList(
  params: {
    mode: "url" | "meeting";
    url?: string;
    group?: string;
    meeting?: string;
  },
  signal?: AbortSignal
) {
  const qs = new URLSearchParams({ mode: params.mode });
  if (params.url) qs.set("url", params.url);
  if (params.group) qs.set("group", params.group);
  if (params.meeting) qs.set("meeting", params.meeting);
  return jsonRequest<{
    sourceUrl: string;
    meetingFolder?: string;
    files: BatchFileItem[];
  }>("/3gpp/doc-assistant/batch-list?" + qs.toString(), { signal });
}

export async function uploadBatchExcel(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(API_BASE + "/3gpp/doc-assistant/batch-excel", {
    method: "POST",
    headers: authHeaders(),
    body: form,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || tr("excelError"));
  return data as {
    tdocs: string[];
    total: number;
    sheets: Array<{ name: string; count: number }>;
  };
}

type ConversionTarget = {
  zipUrl?: string;
  directUrl?: string;
  member?: string;
};
type ConversionResult = Pick<DocZipMember, "status" | "pdfPath" | "error">;

export function startDocConvert(
  payload: ConversionTarget,
  signal?: AbortSignal
) {
  return jsonRequest<ConversionResult>("/3gpp/doc-assistant/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

export function pollDocConvert(params: ConversionTarget, signal?: AbortSignal) {
  const qs = new URLSearchParams();
  if (params.zipUrl) qs.set("zipUrl", params.zipUrl);
  if (params.directUrl) qs.set("directUrl", params.directUrl);
  if (params.member) qs.set("member", params.member);
  return jsonRequest<ConversionResult>(
    "/3gpp/doc-assistant/convert?" + qs.toString(),
    {
      signal,
    }
  );
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function fetchDocumentBlob(
  url: string,
  member: string | undefined,
  signal?: AbortSignal
) {
  const qs = member
    ? new URLSearchParams({ zipUrl: url, member })
    : new URLSearchParams({ url });
  const response = await fetch(
    API_BASE + "/3gpp/doc-assistant/" + (member ? "extract?" : "file?") + qs,
    { headers: authHeaders(), signal }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || tr("apiError"));
  }
  return response.blob();
}

export async function downloadBatchZip(
  items: Array<{
    url?: string;
    tdocId?: string;
    name?: string;
    meetingHint?: string;
  }>,
  meetingHint = "",
  signal?: AbortSignal
): Promise<{ succeeded: number; failed: number; total: number }> {
  const response = await fetch(
    API_BASE + "/3gpp/doc-assistant/batch-download",
    {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ items, meetingHint }),
      signal,
    }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || tr("packError"));
  }
  const summaryHeader = response.headers.get("X-Batch-Summary");
  let summary = { succeeded: items.length, failed: 0, total: items.length };
  if (summaryHeader) {
    try {
      summary = JSON.parse(decodeURIComponent(summaryHeader));
    } catch {
      // ignore
    }
  }
  const disp = response.headers.get("Content-Disposition") || "";
  const match = disp.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : "3gpp-batch.zip";
  const blob = await response.blob();
  triggerBlobDownload(blob, filename);
  return summary;
}
