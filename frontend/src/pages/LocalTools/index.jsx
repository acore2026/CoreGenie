import { useRef, useState } from "react";
import { isMobile } from "react-device-detect";
import {
  DownloadSimple,
  FileDoc,
  FileXls,
  ShieldCheck,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import {
  LIMITS,
  LocalToolError,
  readMeetingList,
  mergeMeetingLists,
  readProposal,
  matchRecords,
  planProposal,
  duplicateNames,
  isDuplicateName,
  generateProposal,
  packageResults,
} from "@/utils/localTools/proposalFill";

const control =
  "min-h-[40px] rounded-md border border-theme-sidebar-border px-3 py-2 text-sm transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${control} bg-primary-button text-slate-950 hover:bg-primary-button hover:brightness-95`;
const input =
  "min-h-[40px] w-full rounded-md border border-theme-sidebar-border bg-theme-bg-chat px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button disabled:opacity-40";
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

export default function LocalTools({ standalone = false }) {
  const { t } = useTranslation();
  const tr = (key, params) => t(`local_tools.${key}`, params);
  const [meeting, setMeeting] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [naming, setNaming] = useState("number");
  const excelRef = useRef(null);
  const excelFolderRef = useRef(null);
  const docsRef = useRef(null);
  const folderRef = useRef(null);
  const operation = useRef(false);
  const nextId = useRef(0);
  const errorText = (error) =>
    error instanceof LocalToolError
      ? tr(`errors.${error.code}`, error.params)
      : tr("errors.read_failed");
  const locked = Boolean(busy);
  const hasRecords = Boolean(meeting?.records.length);
  const plans = items.map((item) => {
    if (!item.proposal || !item.selectedId || !meeting || item.excluded)
      return null;
    try {
      return planProposal(
        item.proposal,
        meeting.records.find((r) => r.id === item.selectedId),
        item.confirmed,
        naming
      );
    } catch (error) {
      return { error: errorText(error) };
    }
  });
  const duplicates = duplicateNames(plans);
  const canExport = plans.some(
    (plan) => plan?.ready && !isDuplicateName(plan.outputName, duplicates)
  );
  const updateItem = (id, changes) => {
    setNotice("");
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  function applyMeetingFiles(files) {
    const records = mergeMeetingLists(files);
    setMeeting(files.length ? { files, records } : null);
    setItems((current) =>
      current.map((item) =>
        item.proposal
          ? {
              ...item,
              ...matchRecords(item.proposal, records),
              confirmed: false,
              exportError: "",
            }
          : item
      )
    );
    setNotice("");
  }

  async function selectMeeting(event, folder = false) {
    const chosen = [...(event.target.files || [])];
    event.target.value = "";
    if (!chosen.length || operation.current) return;
    const files = folder
      ? chosen.filter(
          (file) => /\.xlsx$/i.test(file.name) && !file.name.startsWith("~$")
        )
      : chosen;
    if (!files.length) {
      setError(tr("errors.no_meeting_files"));
      return;
    }
    const existing = meeting?.files || [];
    if (existing.length + files.length > LIMITS.meetingFiles) {
      setError(tr("errors.meeting_count"));
      return;
    }
    if (
      existing.reduce((sum, file) => sum + file.size, 0) +
        files.reduce((sum, file) => sum + file.size, 0) >
      LIMITS.batchBytes
    ) {
      setError(tr("errors.meeting_size"));
      return;
    }
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      const additions = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setProgress(
          tr("read_meeting_progress", {
            current: index + 1,
            total: files.length,
          })
        );
        await pause();
        const entry = {
          id: `meeting-${++nextId.current}`,
          name: file.webkitRelativePath || file.name,
          size: file.size,
        };
        try {
          entry.records = await readMeetingList(file);
        } catch (error) {
          entry.error = errorText(error);
        }
        additions.push(entry);
      }
      applyMeetingFiles([...existing, ...additions]);
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  async function selectDocuments(event, folder = false) {
    const chosen = [...(event.target.files || [])];
    event.target.value = "";
    if (!chosen.length || operation.current) return;
    const files = folder
      ? chosen.filter(
          (f) => /\.docx$/i.test(f.name) && !f.name.startsWith("~$")
        )
      : chosen;
    if (!files.length) {
      setError(tr("errors.no_documents"));
      return;
    }
    if (items.length + files.length > LIMITS.files) {
      setError(tr("errors.batch_count"));
      return;
    }
    if (
      items.reduce((sum, i) => sum + i.file.size, 0) +
        files.reduce((sum, f) => sum + f.size, 0) >
      LIMITS.batchBytes
    ) {
      setError(tr("errors.batch_size"));
      return;
    }
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setProgress(
          tr("read_progress", { current: index + 1, total: files.length })
        );
        await pause();
        const item = {
          id: `proposal-${++nextId.current}`,
          file,
          confirmed: false,
          excluded: false,
        };
        try {
          item.proposal = await readProposal(file);
          Object.assign(
            item,
            hasRecords
              ? matchRecords(item.proposal, meeting.records)
              : { candidates: [], selectedId: "", reason: "" }
          );
        } catch (error) {
          item.error = errorText(error);
        }
        setItems((current) => [...current, item]);
      }
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  async function exportFiles() {
    if (operation.current || !canExport) return;
    operation.current = true;
    setBusy("exporting");
    setError("");
    setNotice("");
    setItems((current) =>
      current.map((item) => ({ ...item, exportError: "" }))
    );
    const results = [];
    const report = [];
    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const plan = plans[index];
        const duplicate =
          plan?.ready && isDuplicateName(plan.outputName, duplicates);
        let reason = item.excluded
          ? tr("excluded")
          : item.error ||
            plan?.error ||
            (duplicate
              ? tr("errors.duplicate")
              : !plan?.ready
                ? tr("pending")
                : "");
        if (!reason) {
          setProgress(
            tr("export_progress", { current: index + 1, total: items.length })
          );
          await pause();
          try {
            results.push({
              name: plan.outputName,
              bytes: await generateProposal(item.proposal, plan),
            });
          } catch (error) {
            reason = errorText(error);
            updateItem(item.id, { exportError: reason });
          }
        }
        report.push({
          [tr("report.original")]: item.file.name,
          [tr("report.output")]: reason ? "" : plan.outputName,
          [tr("report.status")]: reason || tr("report.success"),
          [tr("report.record")]: plan?.record
            ? `${plan.record.sourceFile} / TDoc_List / ${tr("row", { row: plan.record.row })}`
            : "",
          [tr("report.changes")]:
            plan?.changes?.map((c) => ({
              [tr("report.field")]: tr(`fields.${c.field}`),
              [tr("report.before")]: c.before,
              [tr("report.after")]: c.after,
            })) || [],
        });
      }
      if (!results.length) {
        setError(tr("errors.no_output"));
        return;
      }
      const bytes = packageResults(results, report);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/zip" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "3GPP-TDoc.zip";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(
        tr("export_done", {
          count: results.length,
          skipped: items.length - results.length,
        })
      );
    } catch (error) {
      setError(errorText(error));
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-theme-bg-chat text-theme-text-primary">
      {!standalone && (isMobile ? <SidebarMobileHeader /> : <Sidebar />)}
      <main
        className={`min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-12 md:px-8 md:pt-8 ${standalone ? "pt-8" : "pt-24"}`}
      >
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <p className="flex items-center gap-2 text-sm text-theme-text-secondary">
              <Wrench size={18} />
              {tr("nav")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold">{tr("title")}</h1>
            <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
              {tr("description")}
            </p>
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-theme-sidebar-border px-3 py-3 text-sm leading-6">
              <ShieldCheck
                size={20}
                className="mt-0.5 shrink-0 text-emerald-500"
              />
              {tr("privacy")}
            </p>
          </header>

          <section
            className="grid gap-4 md:grid-cols-2"
            aria-label={tr("select_files")}
          >
            <div className="rounded-xl border border-theme-sidebar-border p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <FileXls size={21} />
                {tr("meeting_title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
                {tr("meeting_hint")}
              </p>
              <input
                ref={excelRef}
                type="file"
                accept=".xlsx"
                multiple
                className="hidden"
                aria-label={tr("choose_excel")}
                onChange={selectMeeting}
                disabled={locked}
              />
              <input
                ref={excelFolderRef}
                type="file"
                webkitdirectory=""
                multiple
                className="hidden"
                aria-label={tr("choose_meeting_folder")}
                onChange={(event) => selectMeeting(event, true)}
                disabled={locked}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => excelRef.current.click()}
                >
                  {tr("choose_excel")}
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => excelFolderRef.current.click()}
                >
                  {tr("choose_meeting_folder")}
                </button>
                {meeting && (
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={() => {
                      applyMeetingFiles([]);
                      setError("");
                    }}
                  >
                    {tr("clear_meetings")}
                  </button>
                )}
              </div>
              {meeting && (
                <>
                  <p className="mt-3 text-sm" role="status">
                    {tr("meeting_loaded", {
                      files: meeting.files.filter(
                        (file) => file.records?.length
                      ).length,
                      count: meeting.records.length,
                    })}
                  </p>
                  <ul
                    className="mt-3 space-y-2"
                    aria-label={tr("meeting_files")}
                  >
                    {meeting.files.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-start gap-2 rounded-md border border-theme-sidebar-border p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="break-all text-sm">{file.name}</p>
                          {file.error ? (
                            <p
                              role="alert"
                              className="mt-1 text-sm text-red-500"
                            >
                              {file.error}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-theme-text-secondary">
                              {tr("meeting_record_count", {
                                count: file.records.length,
                              })}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          className={control}
                          disabled={locked}
                          aria-label={tr("remove_meeting", { name: file.name })}
                          onClick={() =>
                            applyMeetingFiles(
                              meeting.files.filter(
                                (entry) => entry.id !== file.id
                              )
                            )
                          }
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="rounded-xl border border-theme-sidebar-border p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <FileDoc size={21} />
                {tr("documents_title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
                {tr("documents_hint")}
              </p>
              <input
                ref={docsRef}
                type="file"
                accept=".docx"
                multiple
                className="hidden"
                aria-label={tr("choose_documents")}
                onChange={selectDocuments}
                disabled={locked || !hasRecords}
              />
              <input
                ref={folderRef}
                type="file"
                webkitdirectory=""
                multiple
                className="hidden"
                aria-label={tr("choose_folder")}
                onChange={(e) => selectDocuments(e, true)}
                disabled={locked || !hasRecords}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={locked || !hasRecords}
                  onClick={() => docsRef.current.click()}
                >
                  {tr("choose_documents")}
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={locked || !hasRecords}
                  onClick={() => folderRef.current.click()}
                >
                  {tr("choose_folder")}
                </button>
              </div>
            </div>
          </section>

          <details className="rounded-lg border border-theme-sidebar-border p-4 text-sm">
            <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button">
              {tr("rules_title")}
            </summary>
            <p className="mt-3 leading-6 text-theme-text-secondary">
              {tr("rules")}
            </p>
          </details>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 p-3 text-sm text-red-500"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-600"
            >
              {notice}
            </p>
          )}
          {locked && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-theme-text-secondary"
            >
              {progress || tr(busy)}
            </p>
          )}

          {items.length > 0 ? (
            <section
              aria-labelledby="proposal-preview-heading"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="proposal-preview-heading"
                  className="text-lg font-semibold"
                >
                  {tr("preview", { count: items.length })}
                </h2>
                <button
                  type="button"
                  disabled={locked}
                  className={control}
                  onClick={() => {
                    setItems([]);
                    setNotice("");
                    setError("");
                  }}
                >
                  {tr("clear")}
                </button>
              </div>
              <label className="block max-w-lg text-sm">
                {tr("naming")}
                <select
                  className={`${input} mt-2`}
                  value={naming}
                  disabled={locked}
                  onChange={(event) => {
                    setNaming(event.target.value);
                    setNotice("");
                  }}
                >
                  <option value="number">{tr("name_number")}</option>
                  <option value="preserve">{tr("name_preserve")}</option>
                </select>
              </label>
              {items.map((item, index) => {
                const plan = plans[index];
                const duplicate =
                  plan?.ready && isDuplicateName(plan.outputName, duplicates);
                return (
                  <article
                    key={item.id}
                    className={`min-w-0 rounded-xl border border-theme-sidebar-border p-4 md:p-5 ${item.excluded ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-all text-sm font-semibold">
                          {item.file.name}
                        </h3>
                        {item.proposal && (
                          <>
                            <p className="mt-2 break-words text-sm">
                              {item.proposal.metadata.title}
                            </p>
                            <p className="mt-1 text-xs text-theme-text-secondary">
                              {item.proposal.metadata.spec} ·{" "}
                              {item.proposal.metadata.release} ·{" "}
                              {item.proposal.metadata.source}
                            </p>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        className={control}
                        disabled={locked}
                        aria-label={tr("remove_file", { name: item.file.name })}
                        onClick={() => {
                          setItems((current) =>
                            current.filter((i) => i.id !== item.id)
                          );
                          setNotice("");
                        }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {item.error ? (
                      <p className="mt-3 text-sm text-red-500" role="alert">
                        {item.error}
                      </p>
                    ) : (
                      <>
                        <label className="mt-4 block text-sm">
                          {tr("matching_record")}
                          <select
                            className={`${input} mt-2`}
                            value={item.selectedId}
                            disabled={locked || item.excluded || !hasRecords}
                            onChange={(e) =>
                              updateItem(item.id, {
                                selectedId: e.target.value,
                                confirmed: false,
                                exportError: "",
                              })
                            }
                          >
                            <option value="">
                              {tr(
                                !hasRecords
                                  ? "choose_meeting_first"
                                  : item.reason || "choose_record"
                              )}
                            </option>
                            {item.candidates.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.tdoc} · {r.spec} · {r.release} · {r.source} ·{" "}
                                {r.sourceFile} · {tr("row", { row: r.row })}
                              </option>
                            ))}
                          </select>
                        </label>
                        {plan?.error && (
                          <p role="alert" className="mt-3 text-sm text-red-500">
                            {plan.error}
                          </p>
                        )}
                        {plan?.changes && (
                          <>
                            <p className="mt-3 break-all text-xs text-theme-text-secondary">
                              {tr("record_source", {
                                name: plan.record.sourceFile,
                                row: plan.record.row,
                              })}
                            </p>
                            <div className="mt-4 divide-y divide-theme-sidebar-border rounded-lg border border-theme-sidebar-border md:hidden">
                              {plan.changes.map((change) => (
                                <div key={change.field} className="p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                                    <p>{tr(`fields.${change.field}`)}</p>
                                    <span className="text-theme-text-secondary">
                                      {tr(
                                        change.conflict
                                          ? "conflict"
                                          : change.changed
                                            ? "fill"
                                            : "unchanged"
                                      )}
                                    </span>
                                  </div>
                                  <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                                    {["before", "after"].map((key) => (
                                      <div key={key} className="min-w-0">
                                        <dt className="text-xs text-theme-text-secondary">
                                          {tr(key)}
                                        </dt>
                                        <dd className="mt-1 break-all font-mono">
                                          {change[key] || tr("blank")}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 hidden overflow-x-auto rounded-lg border border-theme-sidebar-border md:block">
                              <table className="w-full text-left text-sm">
                                <thead className="bg-theme-sidebar-item-hover">
                                  <tr>
                                    {["field", "before", "after", "state"].map(
                                      (key) => (
                                        <th
                                          key={key}
                                          className="px-3 py-2 font-medium"
                                        >
                                          {tr(key)}
                                        </th>
                                      )
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {plan.changes.map((c) => (
                                    <tr
                                      key={c.field}
                                      className="border-t border-theme-sidebar-border"
                                    >
                                      <td className="whitespace-nowrap px-3 py-2">
                                        {tr(`fields.${c.field}`)}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2 font-mono">
                                        {c.before || tr("blank")}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2 font-mono">
                                        {c.after || tr("blank")}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2">
                                        {tr(
                                          c.conflict
                                            ? "conflict"
                                            : c.changed
                                              ? "fill"
                                              : "unchanged"
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {plan.metadataConflicts.map((key) => (
                              <p
                                key={key}
                                className="mt-2 text-sm text-amber-600"
                              >
                                {tr("metadata_difference", {
                                  field: tr(`fields.${key}`),
                                  before: item.proposal.metadata[key],
                                  after: plan.record[key],
                                })}
                              </p>
                            ))}
                            {plan.conflicts > 0 && (
                              <label className="mt-3 flex items-start gap-2 text-sm leading-6">
                                <input
                                  type="checkbox"
                                  className="mt-1.5 h-4 w-4 shrink-0 accent-cyan-600"
                                  checked={item.confirmed}
                                  disabled={locked || item.excluded}
                                  onChange={(e) =>
                                    updateItem(item.id, {
                                      confirmed: e.target.checked,
                                      exportError: "",
                                    })
                                  }
                                />
                                {tr("confirm_conflicts")}
                              </label>
                            )}
                            <p className="mt-3 break-all text-sm">
                              {tr("output_name", { name: plan.outputName })}
                            </p>
                            {duplicate && (
                              <p
                                role="alert"
                                className="mt-2 text-sm text-red-500"
                              >
                                {tr("errors.duplicate")}
                              </p>
                            )}
                          </>
                        )}
                        <label className="mt-3 flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-cyan-600"
                            checked={item.excluded}
                            disabled={locked}
                            onChange={(e) =>
                              updateItem(item.id, {
                                excluded: e.target.checked,
                              })
                            }
                          />
                          {tr("exclude")}
                        </label>
                        {item.exportError && (
                          <p role="alert" className="mt-2 text-sm text-red-500">
                            {item.exportError}
                          </p>
                        )}
                      </>
                    )}
                  </article>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-theme-sidebar-border pt-4">
                <p className="max-w-xl text-sm leading-6 text-theme-text-secondary">
                  {tr("export_hint")}
                </p>
                <button
                  type="button"
                  className={`${primary} flex items-center gap-2`}
                  disabled={locked || !canExport}
                  onClick={exportFiles}
                >
                  <DownloadSimple size={18} />
                  {tr(busy === "exporting" ? "exporting" : "export")}
                </button>
              </div>
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-theme-sidebar-border px-5 py-10 text-center text-sm text-theme-text-secondary">
              {tr("empty")}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
