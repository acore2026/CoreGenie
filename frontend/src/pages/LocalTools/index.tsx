import { useRef } from "react";
import { Link } from "react-router-dom";
import MeetingDownload from "./MeetingDownload";
import paths from "@/utils/paths";
import { isMobile } from "react-device-detect";
import {
  DownloadSimple,
  FileDoc,
  FileXls,
  ArrowLeft,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import ProposalMatch from "./ProposalMatch";
import { useProposalFill } from "./useProposalFill";
import { control, primary, input } from "./proposalControls";

export default function LocalTools({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { t: tr } = useTranslation(undefined, { keyPrefix: "local_tools" });
  const {
    meeting,
    previews,
    naming,
    busy,
    progress,
    error,
    notice,
    locked,
    canExport,
    setRemoteBusy,
    applyDownloadedList,
    selectMeeting,
    selectDocuments,
    clearMeetings,
    removeMeeting,
    clearDocuments,
    removeDocument,
    updateItem,
    changeNaming,
    exportFiles,
  } = useProposalFill();
  const hasRecords = Boolean(meeting?.records.length);
  const excelRef = useRef<HTMLInputElement>(null);
  const docsRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-theme-bg-chat text-theme-text-primary">
      {!standalone && (isMobile ? <SidebarMobileHeader /> : <Sidebar />)}
      <main
        className={`min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-12 md:px-8 md:pt-8 ${standalone ? "pt-8" : "pt-24"}`}
      >
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            {!standalone && (
              <Link
                to={paths.tools()}
                className={`${control} inline-flex items-center gap-2 text-theme-text-secondary`}
              >
                <ArrowLeft size={16} />
                {tr("back_to_tools")}
              </Link>
            )}
            <h1 className="mt-4 text-2xl font-semibold">{tr("title")}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-theme-text-secondary">
              {tr("description")}
            </p>
            <p className="mt-2 text-xs leading-5 text-theme-text-secondary">
              {tr("privacy")}
            </p>
          </header>

          <section
            aria-label={tr("example_title")}
            className="rounded-lg border border-theme-sidebar-border p-4 md:p-5"
          >
            <h2 className="font-medium">{tr("example_title")}</h2>
            <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
              {tr("example_context")}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-xs font-medium text-theme-text-secondary">
                  {tr("example_before")}
                </h3>
                <p className="mt-2 break-all font-mono text-sm">
                  C4-26xxxx.docx
                </p>
                <p className="mt-1 text-sm text-theme-text-secondary">
                  {tr("example_before_values")}
                </p>
              </div>
              <div className="min-w-0 border-t border-theme-sidebar-border pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                <h3 className="text-xs font-medium text-theme-text-secondary">
                  {tr("example_after")}
                </h3>
                <p className="mt-2 break-all font-mono text-sm">
                  C4-265196.docx
                </p>
                <p className="mt-1 text-sm text-theme-text-secondary">
                  {tr("example_after_values")}
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-theme-text-secondary">
              {tr("example_note")}
            </p>
          </section>

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
              <MeetingDownload
                disabled={locked}
                control={control}
                input={input}
                onApply={applyDownloadedList}
                onLoading={setRemoteBusy}
              />
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
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => excelRef.current?.click()}
                >
                  {tr("choose_excel")}
                </button>
                {meeting && (
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={clearMeetings}
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
                          {file.source && (
                            <p className="mt-1 break-all text-xs text-theme-text-secondary">
                              <a
                                href={file.source}
                                target="_blank"
                                rel="noreferrer"
                                className="underline focus-visible:ring-2 focus-visible:ring-primary-button"
                              >
                                {tr("official_source")}
                              </a>
                              {file.fetchedAt &&
                                ` · ${new Date(file.fetchedAt).toLocaleString("zh-CN")}`}
                            </p>
                          )}
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
                                count: file.records?.length || 0,
                              })}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          className={control}
                          disabled={locked}
                          aria-label={tr("remove_meeting", { name: file.name })}
                          onClick={() => removeMeeting(file.id)}
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
                  onClick={() => docsRef.current?.click()}
                >
                  {tr("choose_documents")}
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={locked || !hasRecords}
                  onClick={() => folderRef.current?.click()}
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
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-6 text-theme-text-secondary">
              {(tr("rules", { returnObjects: true }) as string[]).map(
                (rule) => (
                  <li key={rule}>{rule}</li>
                )
              )}
            </ul>
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

          {previews.length > 0 ? (
            <section
              aria-labelledby="proposal-preview-heading"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="proposal-preview-heading"
                  className="text-lg font-semibold"
                >
                  {tr("preview", { count: previews.length })}
                </h2>
                <button
                  type="button"
                  disabled={locked}
                  className={control}
                  onClick={clearDocuments}
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
                  onChange={(event) =>
                    changeNaming(
                      event.target.value === "preserve" ? "preserve" : "number"
                    )
                  }
                >
                  <option value="number">{tr("name_number")}</option>
                  <option value="preserve">{tr("name_preserve")}</option>
                </select>
              </label>
              {previews.map(({ item, plan, duplicate }) => (
                <ProposalMatch
                  key={item.id}
                  item={item}
                  plan={plan}
                  duplicate={duplicate}
                  locked={locked}
                  hasRecords={hasRecords}
                  onRemove={() => removeDocument(item.id)}
                  onChange={(changes) => updateItem(item.id, changes)}
                />
              ))}
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
