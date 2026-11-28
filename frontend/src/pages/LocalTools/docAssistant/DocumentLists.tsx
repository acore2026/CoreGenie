import { useEffect, useRef, useState } from "react";
import { extractTdocIdsFromText } from "@/utils/localTools/docClassifier";
import { AgendaFile } from "./TdocResultView";
import {
  controlClass,
  primaryButtonClass,
  inputClass,
  tr,
  fetchAssistantConfig,
  fetchWgMeetings,
  fetchAgendaAndNotes,
  searchChangeRequestsApi,
  fetchBatchList,
  uploadBatchExcel,
  downloadBatchZip,
  type AgendaResponse,
  type AssistantConfig,
  type CrSearchResponse,
  type MeetingItem,
} from "./api";

type Mode = "agenda" | "cr" | "batch";
type Row = {
  id: string;
  label: string;
  detail?: string;
  url?: string;
  tdocId?: string;
  meetingHint?: string;
};
const panel = "space-y-4 rounded-lg border border-theme-sidebar-border p-4";

export default function DocumentLists({
  mode,
  onViewTdoc,
}: {
  mode: Mode;
  onViewTdoc: (id: string, meeting: string) => void;
}) {
  const [source, setSource] = useState<"meeting" | "url" | "excel" | "paste">(
    "meeting"
  );
  const [pastedText, setPastedText] = useState("");
  const pasting = mode === "batch" && source === "paste";
  const [config, setConfig] = useState<AssistantConfig>();
  const [group, setGroup] = useState("SA2");
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [meeting, setMeeting] = useState("");
  const [chair, setChair] = useState("");
  const [spec, setSpec] = useState("");
  const [release, setRelease] = useState("");
  const [wi, setWi] = useState("");
  const [withdrawn, setWithdrawn] = useState(false);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [agenda, setAgenda] = useState<AgendaResponse>();
  const [cr, setCr] = useState<CrSearchResponse>();
  const [rows, setRows] = useState<Row[]>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  const needsMeeting =
    mode === "agenda" || (mode === "batch" && source === "meeting");
  const limit = config?.maxBatchItems || 50;
  const visible = (rows || []).filter((r) =>
    (r.label + " " + (r.detail || ""))
      .toLowerCase()
      .includes(filter.trim().toLowerCase())
  );
  useEffect(() => {
    const controller = new AbortController();
    fetchAssistantConfig(controller.signal)
      .then(setConfig)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, []);
  useEffect(() => {
    setMeetings([]);
    if (!needsMeeting) return;
    const controller = new AbortController();
    fetchWgMeetings(group, false, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setMeetings(r.meetings);
        const latest = r.meetings[0];
        if (latest)
          setMeeting((current) => (current.trim() ? current : latest.id));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [group, needsMeeting]);
  function clearResults() {
    setRows(undefined);
    setCr(undefined);
    setAgenda(undefined);
    setSelected(new Set());
    setFilter("");
    setMessage("");
    setError("");
  }
  function updatePastedText(value: string) {
    setPastedText(value);
    clearResults();
    const ids = extractTdocIdsFromText(value);
    if (!value.trim()) return;
    setRows(ids.map((id) => ({ id, label: id, tdocId: id })));
    if (ids.length <= limit) setSelected(new Set(ids));
  }

  async function run(action: "search" | "download", page = 1) {
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setBusy(action);
    setMessage("");
    setError("");
    if (action === "search") clearResults();
    try {
      const signal = controller.signal;
      if (action === "download") {
        const items = (rows || [])
          .filter((r) => selected.has(r.id))
          .map((r) => ({
            url: r.url,
            tdocId: r.tdocId,
            meetingHint: pasting ? meeting.trim() : r.meetingHint,
            name: r.url ? r.label : undefined,
          }));
        const summary = await downloadBatchZip(items, "", signal);
        setMessage(tr("downloaded", summary));
      } else if (mode === "agenda") {
        setAgenda(await fetchAgendaAndNotes({ group, meeting, chair }, signal));
      } else if (mode === "cr") {
        const data = await searchChangeRequestsApi(
          {
            spec,
            release,
            meeting,
            workItem: wi,
            includeWithdrawn: withdrawn,
            page,
          },
          signal
        );
        setCr(data);
        const docs = new Map<string, Row>();
        for (const item of data.items) {
          const detail = [
            item.spec,
            item.cr && "CR " + item.cr,
            item.title,
            item.meeting,
            item.wgStatus,
            item.tsgStatus,
          ]
            .filter(Boolean)
            .join(" · ");
          const existing = docs.get(item.tdoc);
          if (existing) existing.detail += " / " + detail;
          else
            docs.set(item.tdoc, {
              id: item.tdoc,
              tdocId: item.tdoc,
              label: item.tdoc,
              detail,
              meetingHint: item.meeting?.split("#").pop()?.trim(),
            });
        }
        setRows([...docs.values()]);
      } else if (source === "excel" && file) {
        const data = await uploadBatchExcel(file, signal);
        setRows(
          data.tdocs.map((id) => ({
            id,
            label: id,
            tdocId: id,
            meetingHint: meeting,
          }))
        );
      } else if (source === "meeting" || source === "url") {
        const data = await fetchBatchList(
          { mode: source, url, group, meeting },
          signal
        );
        setRows(
          data.files.map((f) => ({
            id: f.url,
            label: f.name,
            url: f.url,
            detail: [f.subfolder, f.size].filter(Boolean).join(" · "),
          }))
        );
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : tr("failed"));
    } finally {
      if (!controller.signal.aborted) setBusy("");
    }
  }
  function field(
    label: string,
    value: string,
    setter: (v: string) => void,
    placeholder = "",
    list?: string
  ) {
    return (
      <label className="grid min-w-0 gap-1.5 text-sm">
        {tr(label)}
        <input
          className={inputClass}
          value={value}
          list={list}
          placeholder={placeholder}
          maxLength={label === "directoryUrl" ? 2048 : 160}
          onChange={(e) => setter(e.target.value)}
        />
      </label>
    );
  }
  const valid =
    mode === "cr"
      ? !!(spec.trim() || wi.trim() || meeting.trim())
      : needsMeeting
        ? !!meeting.trim()
        : source === "excel"
          ? !!file
          : !!url.trim();
  return (
    <div className="space-y-4">
      <form
        className={panel}
        onChange={pasting ? undefined : clearResults}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !pasting) run("search");
        }}
      >
        <fieldset disabled={!!busy} className="space-y-4">
          {mode === "batch" && (
            <div className="flex flex-wrap gap-3">
              {(["meeting", "url", "excel", "paste"] as const).map((s) => (
                <label className="flex items-center gap-2 text-sm" key={s}>
                  <input
                    type="radio"
                    checked={source === s}
                    name="batch-source"
                    onChange={() => {
                      clearResults();
                      setPastedText("");
                      setSource(s);
                      setMeeting("");
                    }}
                  />
                  {tr(
                    {
                      meeting: "byMeeting",
                      url: "byUrl",
                      excel: "byExcel",
                      paste: "byPaste",
                    }[s]
                  )}
                </label>
              ))}
            </div>
          )}
          {mode === "cr" && (
            <p className="text-sm text-theme-text-secondary">
              {tr("conditions")}
            </p>
          )}
          {pasting && (
            <label className="grid gap-1.5 text-sm">
              {tr("pastedText")}
              <textarea
                className={inputClass}
                rows={3}
                value={pastedText}
                placeholder={tr("pasteExample")}
                onChange={(e) => updatePastedText(e.target.value)}
              />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {needsMeeting && (
              <label className="grid gap-1.5 text-sm">
                {tr("group")}
                <select
                  className={controlClass}
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value);
                    setMeeting("");
                  }}
                >
                  {(config?.groups || [group]).map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
            )}
            {mode === "cr" && (
              <>
                {field("spec", spec, setSpec, "23.501")}
                {field("release", release, setRelease, "18")}
                {field("workItem", wi, setWi)}
              </>
            )}
            {(needsMeeting ||
              mode === "cr" ||
              (mode === "batch" && source === "excel") ||
              pasting) &&
              field(
                needsMeeting ? "meeting" : "meetingHint",
                meeting,
                setMeeting,
                tr(mode === "cr" ? "meetingCR" : "meetingExample"),
                needsMeeting ? "doc-meetings" : undefined
              )}
            {mode === "agenda" && field("chair", chair, setChair)}
            {mode === "batch" && source === "url" && (
              <div className="sm:col-span-2">
                {field(
                  "directoryUrl",
                  url,
                  setUrl,
                  "https://www.3gpp.org/ftp/…"
                )}
              </div>
            )}
            {mode === "batch" && source === "excel" && (
              <label className="grid min-w-0 gap-1.5 text-sm">
                {tr("sheet")}
                <input
                  type="file"
                  className={inputClass}
                  accept=".xlsx"
                  onChange={(e) => setFile(e.target.files?.[0])}
                />
              </label>
            )}
          </div>
          <datalist id="doc-meetings">
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
          {mode === "cr" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withdrawn}
                onChange={(e) => setWithdrawn(e.target.checked)}
              />
              {tr("includeWithdrawn")}
            </label>
          )}
          {!pasting && (
            <button className={primaryButtonClass} disabled={!valid || !!busy}>
              {tr(
                busy === "search"
                  ? "pending"
                  : mode === "batch"
                    ? "list"
                    : "find"
              )}
            </button>
          )}
        </fieldset>
      </form>
      {busy && (
        <button
          className={controlClass}
          onClick={() => {
            active.current?.abort();
            setBusy("");
            setMessage(tr("cancelled"));
          }}
        >
          {tr("cancel")}
        </button>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}
      {agenda && (
        <section className={panel}>
          <h2 className="break-all font-semibold">
            {agenda.meetingFolder} · {agenda.sourceLabel}
          </h2>
          {(
            [
              ["agendaTitle", agenda.agenda],
              ["notes", agenda.chairNotes],
              ["reports", agenda.reports],
            ] as const
          ).map(
            ([key, list]) =>
              list.length > 0 && (
                <div key={key}>
                  <h3 className="text-sm font-medium">{tr(key)}</h3>
                  <ul className="divide-y divide-theme-sidebar-border">
                    {list.map((f) => (
                      <AgendaFile key={f.url} file={f} />
                    ))}
                  </ul>
                </div>
              )
          )}
          {!agenda.agenda.length &&
            !agenda.chairNotes.length &&
            !agenda.reports.length && <p>{tr("noAgenda")}</p>}
        </section>
      )}
      {rows && (
        <section className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {tr("total", { count: rows.length })}
            </h2>
            {cr && (
              <a
                className={controlClass}
                target="_blank"
                rel="noreferrer"
                href={cr.portalUrl}
              >
                {tr("portal")} ↗
              </a>
            )}
          </div>
          {pasting && rows.length > limit && (
            <p className="text-sm text-theme-text-secondary">
              {tr("confirmLimit", { count: limit })}
            </p>
          )}
          {rows.length > 0 && (
            <>
              <input
                className={inputClass}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label={tr("filter")}
                placeholder={tr("filter")}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className={controlClass}
                  disabled={!!busy || !visible.length}
                  onClick={() => {
                    const next = new Set(selected);
                    for (const row of visible) {
                      if (next.size >= limit) break;
                      next.add(row.id);
                    }
                    setSelected(next);
                  }}
                >
                  {tr("selectShown", { count: limit })}
                </button>
                <button
                  className={controlClass}
                  disabled={!!busy || !selected.size}
                  onClick={() => setSelected(new Set())}
                >
                  {tr("clear")}
                </button>
                <button
                  className={primaryButtonClass}
                  disabled={!!busy || !selected.size}
                  onClick={() => run("download")}
                >
                  {tr(busy === "download" ? "packing" : "package", {
                    count: selected.size,
                  })}
                </button>
              </div>
            </>
          )}
          {visible.length === 0 && (
            <p className="text-sm">
              {tr(pasting && !rows.length ? "pasteEmpty" : "empty")}
            </p>
          )}
          <ul className="max-h-[55vh] divide-y divide-theme-sidebar-border overflow-y-auto">
            {visible.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-start gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(r.id)}
                    disabled={
                      !!busy || (!selected.has(r.id) && selected.size >= limit)
                    }
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 break-words">
                    {r.label}
                    {r.detail && (
                      <small className="block text-theme-text-secondary">
                        {r.detail}
                      </small>
                    )}
                  </span>
                </label>
                {mode === "cr" && (
                  <button
                    type="button"
                    className={controlClass}
                    disabled={!!busy}
                    aria-label={tr("viewTdoc", { id: r.id })}
                    onClick={() => onViewTdoc(r.id, r.meetingHint || "")}
                  >
                    {tr("view")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {cr && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={controlClass}
                disabled={!!busy || cr.page <= 1}
                onClick={() => run("search", cr.page - 1)}
              >
                {tr("prev")}
              </button>
              <span>{tr("page", { page: cr.page })}</span>
              <button
                type="button"
                className={controlClass}
                disabled={!!busy || !cr.hasMore}
                onClick={() => run("search", cr.page + 1)}
              >
                {tr("next")}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
