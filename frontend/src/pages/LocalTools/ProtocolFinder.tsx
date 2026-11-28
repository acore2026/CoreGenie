import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isMobile } from "react-device-detect";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import paths from "@/utils/paths";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import ToolLogo from "./ToolLogo";

interface Entry {
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

interface Result {
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

interface ConvertProgress {
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

interface ZipMember {
  name: string;
  label?: string;
  size: number;
  compressedSize: number;
  isWord: boolean;
  isRevisionMarked: boolean;
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
    | "unsupported";
  cached: boolean;
  pdfPath?: string;
  pdfSize?: number;
  progress?: ConvertProgress;
  error?: string;
}

interface VersionDetail {
  source: "etsi" | "3gpp";
  pdf?: string;
  zipUrl?: string;
  zipName?: string;
  zipSize?: string;
  totalSize?: number;
  wordMaxBytes?: number;
  members?: ZipMember[];
}

const control =
  "min-h-[40px] max-w-full rounded-md border border-theme-sidebar-border bg-theme-bg-chat px-3 py-2 text-sm hover:bg-theme-sidebar-item-hover focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50";

const primaryButton =
  "min-h-[40px] max-w-full rounded-md border border-primary-button bg-primary-button px-3 py-2 text-sm font-medium !text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50";

function authHeaders(extra: Record<string, string> = {}) {
  const base = Object.fromEntries(
    Object.entries(baseHeaders()).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
  return { ...base, ...extra };
}

async function request(params: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(
    API_BASE + "/3gpp/protocol-finder?" + new URLSearchParams(params),
    { headers: authHeaders(), signal }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

async function postConvert(
  payload: { q: string; v: string; member: string },
  signal?: AbortSignal
) {
  const response = await fetch(API_BASE + "/3gpp/protocol-finder/convert", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

async function pollConvert(
  params: { q: string; v: string; member: string },
  signal?: AbortSignal
) {
  const response = await fetch(
    API_BASE + "/3gpp/protocol-finder/convert?" + new URLSearchParams(params),
    { headers: authHeaders(), signal }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function releaseBucket(version: string) {
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) && major <= 2 ? "draft" : String(major);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDuration(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min} 分 ${rem} 秒` : `${min} 分钟`;
}

function isWorkingStatus(status: ZipMember["status"]) {
  return (
    status === "queued" || status === "downloading" || status === "converting"
  );
}

export default function ProtocolFinder() {
  const { t } = useTranslation();
  const tr = (key: string, params?: Record<string, unknown>) =>
    String(t("local_tools.protocol." + key, params));

  const [input, setInput] = useState("");
  const [result, show] = useState<Result | null>(null);
  const [version, select] = useState("");
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [memberFilter, setMemberFilter] = useState("");
  const [subSpecFilter, setSubSpecFilter] = useState("");
  const [busy, loading] = useState(false);
  const [error, fail] = useState("");
  const [message, notify] = useState("");

  const active = useRef<AbortController | null>(null);
  const pollTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const pollControllers = useRef<Map<string, AbortController>>(new Map());

  function clearAllPolls() {
    for (const timer of pollTimers.current.values()) clearTimeout(timer);
    pollTimers.current.clear();
    for (const ctrl of pollControllers.current.values()) ctrl.abort();
    pollControllers.current.clear();
  }

  useEffect(() => {
    return () => {
      active.current?.abort();
      clearAllPolls();
    };
  }, []);

  async function load(q: string, refresh = false) {
    active.current?.abort();
    clearAllPolls();
    const controller = new AbortController();
    active.current = controller;
    loading(true);
    show(null);
    select("");
    setDetail(null);
    setMemberFilter("");
    setSubSpecFilter("");
    fail("");
    notify("");
    try {
      const data: Result = await request(
        { q, refresh: refresh ? "1" : "0" },
        controller.signal
      );
      if (controller.signal.aborted) return;
      show(data);
      select(data.requested || data.index.entries[0]?.version || "");
    } catch (e) {
      if (!controller.signal.aborted)
        fail(e instanceof Error ? e.message : tr("failed"));
    } finally {
      if (!controller.signal.aborted) loading(false);
    }
  }

  const entry = result?.index.entries.find((e) => e.version === version);
  const specQuery = result ? `${result.type} ${result.id}` : "";

  useEffect(() => {
    clearAllPolls();
    setDetail(null);
    setMemberFilter("");
    notify("");
    if (!result || !entry) return;
    const controller = new AbortController();
    setDetailLoading(true);
    request(
      { q: `${result.type} ${result.id}`, v: entry.version },
      controller.signal
    )
      .then((data: VersionDetail) => {
        if (controller.signal.aborted) return;
        setDetail(data);
        if (data.source === "3gpp" && data.members) {
          for (const m of data.members) {
            if (isWorkingStatus(m.status)) {
              schedulePoll(
                `${result.type} ${result.id}`,
                entry.version,
                m.name
              );
            }
          }
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          fail(e instanceof Error ? e.message : tr("failed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => {
      controller.abort();
      clearAllPolls();
    };
  }, [result, entry]);

  function updateMemberState(memberName: string, patch: Partial<ZipMember>) {
    setDetail((prev) => {
      if (!prev?.members) return prev;
      return {
        ...prev,
        members: prev.members.map((m) =>
          m.name === memberName ? { ...m, ...patch } : m
        ),
      };
    });
  }

  function schedulePoll(q: string, v: string, memberName: string) {
    const key = `${q}|${v}|${memberName}`;
    if (pollTimers.current.has(key)) return;
    const timer = setTimeout(async () => {
      pollTimers.current.delete(key);
      const ctrl = new AbortController();
      pollControllers.current.set(key, ctrl);
      try {
        const data = await pollConvert(
          { q, v, member: memberName },
          ctrl.signal
        );
        if (ctrl.signal.aborted) return;
        updateMemberState(memberName, {
          status: data.status,
          pdfPath: data.pdfPath,
          pdfSize: data.size,
          cached: Boolean(data.cached),
          progress: data.progress,
          error: data.error,
        });
        if (isWorkingStatus(data.status)) {
          schedulePoll(q, v, memberName);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          updateMemberState(memberName, {
            status: "failed",
            error: e instanceof Error ? e.message : tr("failed"),
          });
        }
      } finally {
        pollControllers.current.delete(key);
      }
    }, 1200);
    pollTimers.current.set(key, timer);
  }

  async function startConvert(member: ZipMember) {
    if (!result || !entry) return;
    fail("");
    notify("");
    updateMemberState(member.name, { status: "queued", error: undefined });
    try {
      const data = await postConvert({
        q: specQuery,
        v: entry.version,
        member: member.name,
      });
      updateMemberState(member.name, {
        status: data.status,
        pdfPath: data.pdfPath,
        pdfSize: data.size,
        cached: Boolean(data.cached),
        progress: data.progress,
        error: data.error,
      });
      if (isWorkingStatus(data.status)) {
        schedulePoll(specQuery, entry.version, member.name);
      }
    } catch (e) {
      updateMemberState(member.name, {
        status: "failed",
        error: e instanceof Error ? e.message : tr("failed"),
      });
    }
  }

  function pick(v: string) {
    if (v !== version) {
      setDetail(null);
      fail("");
      select(v);
    }
  }

  const entries = result?.index.entries || [];
  const release = version ? releaseBucket(version) : "";
  const releases = [...new Set(entries.map((e) => releaseBucket(e.version)))];
  const citationUrl =
    detail?.source === "etsi"
      ? detail.pdf || ""
      : detail?.zipUrl || entry?.zipUrl || "";

  async function copy() {
    if (!result || !citationUrl) return;
    const relText = release === "draft" ? "Draft" : `Release ${release}`;
    const citation = `3GPP ${result.type} ${result.id} V${version}, ${relText}. ${citationUrl}`;
    try {
      await navigator.clipboard.writeText(citation);
      notify(tr("copied"));
    } catch {
      notify(tr("manual") + "：" + citation);
    }
  }

  function statusButtonLabel(status: ZipMember["status"]) {
    if (status === "queued") return tr("status_queued");
    if (status === "downloading") return tr("status_downloading");
    if (status === "converting") return tr("status_converting");
    if (status === "failed") return tr("retry_pdf");
    return tr("generate_pdf");
  }

  function renderProgress(member: ZipMember) {
    if (!isWorkingStatus(member.status)) return null;
    const p = member.progress;
    const stage = p?.stage || member.status;
    const wordBytes = p?.wordBytes || member.size || 0;

    let label = tr("status_converting");
    let determinatePercent: number | null = null;

    if (stage === "queued") {
      label =
        p?.queuePosition && p.queuePosition > 1
          ? tr("progress_queued_pos", { count: p.queuePosition - 1 })
          : tr("progress_queued");
    } else if (stage === "downloading") {
      const loaded = p?.downloadedBytes || 0;
      const total = p?.downloadTotalBytes || member.compressedSize || 0;
      if (total > 0) {
        const pct = Math.min(100, Math.round((loaded / total) * 100));
        determinatePercent = pct;
        label = tr("progress_downloading", {
          loaded: formatBytes(loaded) || "0 KB",
          total: formatBytes(total),
          percent: pct,
        });
      } else {
        label = tr("progress_downloading_simple");
      }
    } else if (stage === "writing_pdf" && p?.pdfBytes) {
      label = tr("progress_writing_pdf", { size: formatBytes(p.pdfBytes) });
    } else if (stage === "finalizing") {
      label = tr("progress_finalizing");
      determinatePercent = 98;
    } else {
      label = tr("progress_converting");
    }

    const elapsedText =
      p && p.elapsedMs >= 1000
        ? tr("progress_elapsed", { time: formatDuration(p.elapsedMs) })
        : "";
    const showLargeHint =
      (stage === "converting" || stage === "writing_pdf") &&
      wordBytes >= 8 * 1024 * 1024;

    return (
      <div
        className="mt-2 space-y-1.5 rounded-md border border-theme-sidebar-border bg-theme-bg-secondary/30 px-3 py-2 text-xs text-theme-text-secondary"
        role="status"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{label}</span>
          {elapsedText && <span className="font-mono">{elapsedText}</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-theme-sidebar-border/60">
          {determinatePercent !== null ? (
            <div
              className="h-full rounded-full bg-primary-button transition-all duration-300"
              style={{ width: `${Math.max(4, determinatePercent)}%` }}
            />
          ) : (
            <div className="h-full w-2/5 animate-pulse rounded-full bg-primary-button/80" />
          )}
        </div>
        {showLargeHint && (
          <p className="text-[11px] leading-relaxed">
            {tr("progress_large_hint", { size: formatBytes(wordBytes) })}
          </p>
        )}
      </div>
    );
  }

  const members = detail?.members || [];
  const hasKiSplit = members.some((m) => Boolean(m.label?.startsWith("KI#")));
  const subSpecs = result?.subSpecs || [];
  const filteredSubSpecs = subSpecs.filter((s) => {
    const needle = subSpecFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      s.id.toLowerCase().includes(needle) ||
      (s.group || "").toLowerCase().includes(needle) ||
      (s.title || "").toLowerCase().includes(needle)
    );
  });
  const singleMember =
    detail?.source === "3gpp" && members.length === 1 ? members[0] : null;
  const filteredMembers = members.filter((m) => {
    const needle = memberFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      m.name.toLowerCase().includes(needle) ||
      (m.label || "").toLowerCase().includes(needle)
    );
  });

  const hasBothSources = Boolean(
    result?.sources?.etsi && result?.sources?.threeGpp
  );

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-theme-bg-chat text-theme-text-primary">
      {isMobile ? <SidebarMobileHeader /> : <Sidebar />}
      <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-12 pt-24 md:px-8 md:pt-8">
        <div className="mx-auto max-w-5xl space-y-5">
          <Link className={control + " inline-block"} to={paths.tools()}>
            ← {t("local_tools.back_to_tools")}
          </Link>
          <header className="flex items-start gap-3.5">
            <ToolLogo tool="protocol-finder" size="md" />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">{tr("title")}</h1>
              <p className="mt-1 text-sm text-theme-text-secondary">
                {tr("description")}
              </p>
              <p className="mt-1 text-xs text-theme-text-secondary/70">
                {t("local_tools.contributor_label", {
                  name: t("local_tools.contributors.protocol-finder"),
                })}
              </p>
            </div>
          </header>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              load(input.trim());
            }}
          >
            <label className="grid min-w-0 flex-1 gap-2">
              {tr("label")}
              <input
                className={control}
                placeholder={tr("hint")}
                value={input}
                maxLength={100}
                onChange={(e) => setInput(e.target.value)}
              />
            </label>
            <button className={control} disabled={!input.trim() || busy}>
              {tr(busy ? "loading" : "search")}
            </button>
          </form>

          {result && subSpecs.length > 0 && (
            <section className="space-y-3 rounded-lg border border-primary-button/40 bg-theme-bg-secondary/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">
                  {tr(
                    entries.length === 0
                      ? "sub_specs_only_title"
                      : "sub_specs_related_title",
                    { id: result.id, count: subSpecs.length }
                  )}
                </h2>
                {subSpecs.length > 8 && (
                  <input
                    className={control + " w-full sm:w-72"}
                    placeholder={tr("sub_specs_filter_placeholder")}
                    value={subSpecFilter}
                    onChange={(e) => setSubSpecFilter(e.target.value)}
                  />
                )}
              </div>
              {filteredSubSpecs.length === 0 ? (
                <p className="text-sm text-theme-text-secondary">
                  {tr("filter_empty")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {filteredSubSpecs.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      className={
                        control + " flex flex-wrap items-center gap-2 text-left"
                      }
                      onClick={() => {
                        setInput(sub.id);
                        load(sub.id);
                      }}
                    >
                      <span className="font-mono font-semibold">
                        {sub.type} {sub.id}
                      </span>
                      {(sub.group || sub.title) && (
                        <span className="text-theme-text-secondary">
                          {[sub.group, sub.title].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {sub.kiCount && (
                        <span className="rounded border border-theme-sidebar-border px-1.5 py-0.5 text-xs text-theme-text-secondary">
                          {tr("sub_specs_ki_badge", { count: sub.kiCount })}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {entries.length === 0 && (
                <div className="flex flex-wrap items-center gap-3 pt-1 text-sm text-theme-text-secondary">
                  {result.archiveDir && (
                    <a
                      className={control}
                      href={result.archiveDir}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {tr("archive_directory")} ↗
                    </a>
                  )}
                  <button
                    type="button"
                    className={control}
                    onClick={() => load(result.id, true)}
                  >
                    {tr("refresh")}
                  </button>
                </div>
              )}
            </section>
          )}

          {result && entries.length > 0 && (
            <section className="space-y-4 rounded-lg border border-theme-sidebar-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">
                  {result.type} {result.id}
                  {result.title ? ` · ${result.title}` : ""}
                </h2>
                {entry && (
                  <span className="rounded border border-theme-sidebar-border px-2 py-0.5 text-xs text-theme-text-secondary">
                    {entry.source === "3gpp"
                      ? tr("source_3gpp")
                      : tr("source_etsi")}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  {tr("release")}
                  <select
                    className={control}
                    value={release}
                    onChange={(e) => {
                      const next = entries.find(
                        (x) => releaseBucket(x.version) === e.target.value
                      );
                      if (next) pick(next.version);
                    }}
                  >
                    {!releases.includes(release) && (
                      <option value={release}>
                        {release === "draft" ? tr("draft_release") : release}
                      </option>
                    )}
                    {releases.map((r) => (
                      <option key={r} value={r}>
                        {r === "draft" ? tr("draft_release") : r}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2">
                  {tr("revision")}
                  <select
                    className={control}
                    value={version}
                    onChange={(e) => pick(e.target.value)}
                  >
                    {!entry && <option value={version}>{version}</option>}
                    {entries
                      .filter((e) => releaseBucket(e.version) === release)
                      .map((e) => (
                        <option key={e.version} value={e.version}>
                          {e.version}
                          {hasBothSources
                            ? `（${e.source === "3gpp" ? tr("source_3gpp_short") : tr("source_etsi_short")}）`
                            : ""}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              {entry ? (
                <p className="text-sm text-theme-text-secondary">
                  {tr("folder")} · {entry.date || "-"}
                  {entry.zipSize ? ` · ${entry.zipSize}` : ""}
                </p>
              ) : (
                <p>{tr("missing")}</p>
              )}

              {entry?.source === "3gpp" && (
                <p className="rounded-md border border-theme-sidebar-border bg-theme-bg-secondary/40 px-3 py-2 text-xs text-theme-text-secondary">
                  {tr("convert_notice")}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {detail?.source === "etsi" && detail.pdf && (
                  <a
                    className={primaryButton}
                    href={detail.pdf}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tr("open")} ↗
                  </a>
                )}

                {singleMember &&
                  (singleMember.status === "ready" && singleMember.pdfPath ? (
                    <a
                      className={primaryButton}
                      href={API_BASE + singleMember.pdfPath}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {tr("open")} ↗
                    </a>
                  ) : singleMember.convertible ? (
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={isWorkingStatus(singleMember.status)}
                      onClick={() => startConvert(singleMember)}
                    >
                      {statusButtonLabel(singleMember.status)}
                    </button>
                  ) : null)}

                {detailLoading && entry && !error && (
                  <span
                    className="text-sm text-theme-text-secondary"
                    role="status"
                  >
                    {entry.source === "3gpp"
                      ? tr("loading_members")
                      : tr("loading")}
                  </span>
                )}

                <button
                  type="button"
                  className={control}
                  disabled={!citationUrl}
                  onClick={copy}
                >
                  {tr("copy")}
                </button>

                {(detail?.zipUrl || entry?.zipUrl) && (
                  <a
                    className={control}
                    href={detail?.zipUrl || entry?.zipUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tr("download_zip")} ↗
                  </a>
                )}

                {result.dir && (
                  <a
                    className={control}
                    href={result.dir}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tr("directory")} ↗
                  </a>
                )}

                {result.archiveDir && (
                  <a
                    className={control}
                    href={result.archiveDir}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tr("archive_directory")} ↗
                  </a>
                )}
              </div>

              {singleMember && (
                <div className="text-sm">
                  {renderProgress(singleMember)}
                  {singleMember.status === "ready" && (
                    <p className="text-theme-text-secondary" role="status">
                      {singleMember.cached
                        ? tr("status_cached")
                        : tr("status_ready")}
                      {singleMember.pdfSize
                        ? ` · ${formatBytes(singleMember.pdfSize)}`
                        : ""}
                    </p>
                  )}
                  {singleMember.error && (
                    <p className="text-red-400" role="alert">
                      {singleMember.error}
                    </p>
                  )}
                  {!singleMember.convertible && singleMember.reason && (
                    <p className="text-theme-text-secondary">
                      {singleMember.reason}
                    </p>
                  )}
                </div>
              )}

              {detail?.source === "3gpp" &&
                members.length === 0 &&
                !detailLoading && (
                  <p className="text-sm text-theme-text-secondary">
                    {tr("no_members")}
                  </p>
                )}

              {detail?.source === "3gpp" && members.length > 1 && (
                <div className="space-y-3 border-t border-theme-sidebar-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">
                      {tr(hasKiSplit ? "ki_members_count" : "members_count", {
                        count: members.length,
                      })}
                    </h3>
                    {members.length > 4 && (
                      <input
                        className={control + " w-full sm:w-80"}
                        placeholder={tr("filter_placeholder")}
                        value={memberFilter}
                        onChange={(e) => setMemberFilter(e.target.value)}
                      />
                    )}
                  </div>

                  {filteredMembers.length === 0 ? (
                    <p className="text-sm text-theme-text-secondary">
                      {tr("filter_empty")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-theme-sidebar-border rounded-md border border-theme-sidebar-border">
                      {filteredMembers.map((m) => (
                        <li
                          key={m.name}
                          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {m.label ? (
                                <span className="text-sm font-medium">
                                  {m.label}
                                </span>
                              ) : (
                                <span className="break-all font-mono text-sm font-medium">
                                  {m.name}
                                </span>
                              )}
                              <span className="text-xs text-theme-text-secondary">
                                {formatBytes(m.size)}
                              </span>
                              {m.status === "ready" && (
                                <span className="rounded border border-theme-sidebar-border px-1.5 py-0.5 text-xs text-theme-text-secondary">
                                  {tr("status_cached")}
                                </span>
                              )}
                            </div>
                            {m.label && (
                              <p className="break-all font-mono text-xs text-theme-text-secondary">
                                {m.name}
                              </p>
                            )}
                            {!m.convertible && m.reason && (
                              <p className="text-xs text-theme-text-secondary">
                                {m.reason}
                              </p>
                            )}
                            {m.error && (
                              <p className="text-xs text-red-400" role="alert">
                                {m.error}
                              </p>
                            )}
                            {renderProgress(m)}
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {m.status === "ready" && m.pdfPath ? (
                              <a
                                className={primaryButton}
                                href={API_BASE + m.pdfPath}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {tr("open")} ↗
                              </a>
                            ) : m.convertible ? (
                              <button
                                type="button"
                                className={control}
                                disabled={isWorkingStatus(m.status)}
                                onClick={() => startConvert(m)}
                              >
                                {statusButtonLabel(m.status)}
                              </button>
                            ) : (
                              detail.zipUrl && (
                                <a
                                  className={control}
                                  href={detail.zipUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {tr("download_zip")} ↗
                                </a>
                              )
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-sm text-theme-text-secondary">
                {tr("checked")} ·{" "}
                {new Date(result.index.checked).toLocaleString("zh-CN")}
                <button
                  type="button"
                  className={control}
                  onClick={() =>
                    load(result.type + " " + result.id + " V" + version, true)
                  }
                >
                  {tr("refresh")}
                </button>
              </div>
              {result.warning && <p role="status">{result.warning}</p>}
            </section>
          )}
          {error && <p role="alert">{error}</p>}
          {message && (
            <p className="break-all" role="status">
              {message}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
