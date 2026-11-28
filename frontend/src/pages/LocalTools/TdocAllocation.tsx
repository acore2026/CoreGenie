import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { isMobile } from "react-device-detect";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  DownloadSimple,
  FileDoc,
  FileXls,
  X,
} from "@phosphor-icons/react";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import paths from "@/utils/paths";
import { LIMITS, LocalToolError } from "@/utils/localTools/proposalFill";
import {
  readFileBytes,
  triggerBrowserDownload,
} from "@/utils/localTools/ooxml";
import {
  ALLOCATION_FOR_OPTIONS,
  ALLOCATION_TYPE_OPTIONS,
  exportAllocationWorkbook,
  readWordForAllocation,
  type AllocationColumn,
  type AllocationItem,
} from "@/utils/localTools/tdocAllocation";
import { control, input, primary } from "./proposalControls";
import ToolLogo from "./ToolLogo";

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const EXTRA_COLUMNS: readonly AllocationColumn[] = [
  "TDoc sort order within agenda item",
  "Is revision of",
  "CR",
  "CR revision",
  "TSG CR Pack",
  "Reply to",
  "To",
  "Cc",
  "Original LS",
  "Reply in",
];

export default function TdocAllocation({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, params?: Record<string, string | number>) =>
    String(t(`local_tools.tdoc_alloc.${key}`, params));

  const [items, setItems] = useState<AllocationItem[]>([]);
  const [templateInfo, setTemplateInfo] = useState<{
    name: string;
    bytes: Uint8Array;
  } | null>(null);
  const [batchContactId, setBatchContactId] = useState("");
  const [batchFor, setBatchFor] = useState("Agreement");
  const [batchAgenda, setBatchAgenda] = useState("");
  const [batchSource, setBatchSource] = useState("");
  const [releaseAgendas, setReleaseAgendas] = useState<Record<string, string>>(
    {}
  );
  const [busy, setBusy] = useState<"" | "reading" | "exporting">("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const operation = useRef(false);
  const nextId = useRef(0);

  const docsRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const locked = Boolean(busy);

  const errorText = (err: unknown): string =>
    err instanceof LocalToolError
      ? String(t(`local_tools.errors.${err.code}`, err.params))
      : String(t("local_tools.errors.read_failed"));

  const activeItems = useMemo(
    () => items.filter((item) => !item.excluded && !item.error),
    [items]
  );

  const presentReleases = useMemo(() => {
    return [
      ...new Set(items.map((i) => i.values.Release).filter(Boolean)),
    ].sort();
  }, [items]);

  async function selectDocuments(
    event: ChangeEvent<HTMLInputElement>,
    folder = false
  ) {
    const chosen = [...(event.target.files || [])];
    event.target.value = "";
    if (!chosen.length || operation.current) return;
    const files = folder
      ? chosen.filter(
          (f) => /\.docx$/i.test(f.name) && !f.name.startsWith("~$")
        )
      : chosen;
    if (!files.length) {
      setError(String(t("local_tools.errors.no_documents")));
      return;
    }
    if (items.length + files.length > LIMITS.files) {
      setError(String(t("local_tools.errors.batch_count")));
      return;
    }
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(
          String(
            t("local_tools.read_progress", {
              current: i + 1,
              total: files.length,
            })
          )
        );
        await pause();
        const id = `alloc-${++nextId.current}`;
        try {
          const parsed = await readWordForAllocation(file, id);
          if (batchContactId && !parsed.values["Contact ID"]) {
            parsed.values["Contact ID"] = batchContactId;
          }
          if (batchAgenda && !parsed.values["Agenda item"]) {
            parsed.values["Agenda item"] = batchAgenda;
          }
          setItems((curr) => [...curr, parsed]);
        } catch (err) {
          setItems((curr) => [
            ...curr,
            {
              id,
              fileName: file.name,
              kind: "unknown",
              values: {
                Title: "",
                Source: "",
                "Contact ID": "",
                Type: "",
                For: "",
                "Agenda item": "",
                "TDoc sort order within agenda item": "",
                "Is revision of": "",
                Release: "",
                Spec: "",
                Version: "",
                "Related WIs": "",
                CR: "",
                "CR revision": "",
                "CR category": "",
                "TSG CR Pack": "",
                "Reply to": "",
                To: "",
                Cc: "",
                "Original LS": "",
                "Reply in": "",
              },
              excluded: false,
              error: errorText(err),
            },
          ]);
        }
      }
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  async function selectTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || operation.current) return;
    setError("");
    setNotice("");
    try {
      const bytes = await readFileBytes(file, ".xlsx");
      setTemplateInfo({ name: file.name, bytes });
    } catch (err) {
      setError(errorText(err));
    }
  }

  function updateField(id: string, col: AllocationColumn, value: string) {
    setNotice("");
    setItems((curr) =>
      curr.map((item) =>
        item.id === id
          ? { ...item, values: { ...item.values, [col]: value } }
          : item
      )
    );
  }

  function toggleExcluded(id: string, excluded: boolean) {
    setNotice("");
    setItems((curr) =>
      curr.map((item) => (item.id === id ? { ...item, excluded } : item))
    );
  }

  function removeItem(id: string) {
    setNotice("");
    setItems((curr) => curr.filter((item) => item.id !== id));
  }

  function applyBatchDefaults() {
    setNotice("");
    setItems((curr) =>
      curr.map((item) => {
        if (item.error) return item;
        const next = { ...item.values };
        if (batchContactId.trim()) next["Contact ID"] = batchContactId.trim();
        if (batchFor.trim()) next.For = batchFor.trim();
        if (batchSource.trim()) next.Source = batchSource.trim();
        const relAgenda =
          (next.Release && releaseAgendas[next.Release]?.trim()) || "";
        if (relAgenda) {
          next["Agenda item"] = relAgenda;
        } else if (batchAgenda.trim()) {
          next["Agenda item"] = batchAgenda.trim();
        }
        return { ...item, values: next };
      })
    );
    setNotice(tr("batch_applied"));
  }

  function handleExport() {
    if (!activeItems.length) return;
    setError("");
    setBusy("exporting");
    try {
      const bytes = exportAllocationWorkbook(
        activeItems.map((i) => i.values),
        templateInfo?.bytes ?? null
      );
      const outName =
        templateInfo?.name || "Template_Bulk_TDoc_Allocation.xlsx";
      triggerBrowserDownload(
        bytes,
        outName,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      setNotice(
        tr("export_done", { count: activeItems.length, name: outName })
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
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
            {!standalone && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={paths.tools()}
                  className={`${control} inline-flex items-center gap-2 text-theme-text-secondary`}
                >
                  <ArrowLeft size={16} />
                  {t("local_tools.back_to_tools")}
                </Link>
                <Link
                  to={paths.proposalFill()}
                  className={`${control} inline-flex items-center gap-2 text-theme-text-secondary`}
                >
                  {tr("next_step_link")}
                  <ArrowRight size={16} />
                </Link>
              </div>
            )}
            <div className="mt-4 flex items-start gap-3.5">
              <ToolLogo tool="tdoc-allocation" size="md" />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold">{tr("title")}</h1>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-theme-text-secondary">
                  {tr("description")}
                </p>
                <p className="mt-1.5 text-xs leading-5 text-theme-text-secondary">
                  {tr("privacy")}
                  <span className="ml-2 text-theme-text-secondary/70">
                    ·{" "}
                    {t("local_tools.contributor_label", {
                      name: t("local_tools.contributors.tdoc-allocation"),
                    })}
                  </span>
                </p>
              </div>
            </div>
          </header>

          <section
            className="grid gap-4 md:grid-cols-2"
            aria-label={tr("select_section")}
          >
            <div className="rounded-xl border border-theme-sidebar-border p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <FileDoc size={21} />
                {tr("step1_title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
                {tr("step1_hint")}
              </p>
              <input
                ref={docsRef}
                type="file"
                accept=".docx"
                multiple
                className="hidden"
                aria-label={t("local_tools.choose_documents")}
                onChange={(e) => selectDocuments(e, false)}
                disabled={locked}
              />
              <input
                ref={folderRef}
                type="file"
                webkitdirectory=""
                multiple
                className="hidden"
                aria-label={t("local_tools.choose_folder")}
                onChange={(e) => selectDocuments(e, true)}
                disabled={locked}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => docsRef.current?.click()}
                >
                  {t("local_tools.choose_documents")}
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => folderRef.current?.click()}
                >
                  {t("local_tools.choose_folder")}
                </button>
                {items.length > 0 && (
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={() => {
                      setItems([]);
                      setNotice("");
                      setError("");
                    }}
                  >
                    {t("local_tools.clear")}
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-theme-sidebar-border p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <FileXls size={21} />
                {tr("step2_title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
                {tr("step2_hint")}
              </p>
              <input
                ref={templateRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                aria-label={tr("choose_template")}
                onChange={selectTemplate}
                disabled={locked}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => templateRef.current?.click()}
                >
                  {tr("choose_template")}
                </button>
                {templateInfo && (
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={() => setTemplateInfo(null)}
                  >
                    {tr("clear_template")}
                  </button>
                )}
              </div>
              {templateInfo && (
                <p className="mt-3 break-all text-xs text-theme-text-secondary">
                  {tr("template_loaded", { name: templateInfo.name })}
                </p>
              )}
            </div>
          </section>

          {items.length > 0 && (
            <section
              className="rounded-xl border border-theme-sidebar-border p-5"
              aria-label={tr("batch_title")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-medium">{tr("batch_title")}</h2>
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    {tr("batch_hint")}
                  </p>
                </div>
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={applyBatchDefaults}
                >
                  {tr("apply_batch")}
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-xs text-theme-text-secondary">
                  Contact ID
                  <input
                    type="text"
                    className={`${input} mt-1 font-mono`}
                    placeholder={tr("contact_id_placeholder")}
                    value={batchContactId}
                    disabled={locked}
                    onChange={(e) => setBatchContactId(e.target.value)}
                  />
                </label>
                <label className="block text-xs text-theme-text-secondary">
                  For
                  <select
                    className={`${input} mt-1`}
                    value={batchFor}
                    disabled={locked}
                    onChange={(e) => setBatchFor(e.target.value)}
                  >
                    {ALLOCATION_FOR_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-theme-text-secondary">
                  {tr("batch_agenda")}
                  <input
                    type="text"
                    className={`${input} mt-1 font-mono`}
                    placeholder="20.24"
                    value={batchAgenda}
                    disabled={locked}
                    onChange={(e) => setBatchAgenda(e.target.value)}
                  />
                </label>
                <label className="block text-xs text-theme-text-secondary">
                  {tr("batch_source")}
                  <input
                    type="text"
                    className={`${input} mt-1`}
                    placeholder={tr("leave_blank_keep")}
                    value={batchSource}
                    disabled={locked}
                    onChange={(e) => setBatchSource(e.target.value)}
                  />
                </label>
              </div>
              {presentReleases.length > 0 && (
                <div className="mt-4 border-t border-theme-sidebar-border pt-3">
                  <p className="text-xs text-theme-text-secondary">
                    {tr("agenda_by_release")}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {presentReleases.map((rel) => (
                      <label
                        key={rel}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="shrink-0 font-mono">{rel}</span>
                        <input
                          type="text"
                          className={`${input} font-mono`}
                          placeholder="Agenda item"
                          value={releaseAgendas[rel] || ""}
                          disabled={locked}
                          onChange={(e) =>
                            setReleaseAgendas((curr) => ({
                              ...curr,
                              [rel]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

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
              {progress}
            </p>
          )}

          {items.length > 0 ? (
            <section
              aria-labelledby="alloc-preview-heading"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  id="alloc-preview-heading"
                  className="text-lg font-semibold"
                >
                  {tr("preview_heading", {
                    active: activeItems.length,
                    total: items.length,
                  })}
                </h2>
              </div>

              {items.map((item) => (
                <article
                  key={item.id}
                  className={`rounded-xl border border-theme-sidebar-border p-4 md:p-5 ${item.excluded ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-all text-sm font-semibold">
                        {item.fileName}
                      </h3>
                      {!item.error && (
                        <p className="mt-1 text-xs text-theme-text-secondary">
                          {item.values.Type || tr("unknown_type")}
                          {item.values.Spec ? ` · ${item.values.Spec}` : ""}
                          {item.values.Release
                            ? ` · ${item.values.Release}`
                            : ""}
                          {!item.values["Agenda item"]
                            ? ` · ${tr("missing_agenda")}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className={control}
                      disabled={locked}
                      aria-label={String(
                        t("local_tools.remove_file", { name: item.fileName })
                      )}
                      onClick={() => removeItem(item.id)}
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
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="block text-xs text-theme-text-secondary sm:col-span-2">
                          Title
                          <input
                            type="text"
                            className={`${input} mt-1`}
                            value={item.values.Title}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "Title", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Source
                          <input
                            type="text"
                            className={`${input} mt-1`}
                            value={item.values.Source}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "Source", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Contact ID
                          <input
                            type="text"
                            className={`${input} mt-1 font-mono`}
                            value={item.values["Contact ID"]}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "Contact ID", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Type
                          <select
                            className={`${input} mt-1`}
                            value={item.values.Type}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "Type", e.target.value)
                            }
                          >
                            {!ALLOCATION_TYPE_OPTIONS.includes(
                              item.values
                                .Type as (typeof ALLOCATION_TYPE_OPTIONS)[number]
                            ) &&
                              item.values.Type && (
                                <option value={item.values.Type}>
                                  {item.values.Type}
                                </option>
                              )}
                            {ALLOCATION_TYPE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          For
                          <select
                            className={`${input} mt-1`}
                            value={item.values.For}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "For", e.target.value)
                            }
                          >
                            {!ALLOCATION_FOR_OPTIONS.includes(
                              item.values
                                .For as (typeof ALLOCATION_FOR_OPTIONS)[number]
                            ) &&
                              item.values.For && (
                                <option value={item.values.For}>
                                  {item.values.For}
                                </option>
                              )}
                            {ALLOCATION_FOR_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Agenda item
                          <input
                            type="text"
                            className={`${input} mt-1 font-mono`}
                            placeholder="20.24"
                            value={item.values["Agenda item"]}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(
                                item.id,
                                "Agenda item",
                                e.target.value
                              )
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Release
                          <input
                            type="text"
                            className={`${input} mt-1 font-mono`}
                            value={item.values.Release}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "Release", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Spec
                          <input
                            type="text"
                            className={`${input} mt-1 font-mono`}
                            value={item.values.Spec}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "Spec", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Version
                          <input
                            type="text"
                            className={`${input} mt-1 font-mono`}
                            value={item.values.Version}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(item.id, "Version", e.target.value)
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          Related WIs
                          <input
                            type="text"
                            className={`${input} mt-1 font-mono`}
                            value={item.values["Related WIs"]}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(
                                item.id,
                                "Related WIs",
                                e.target.value
                              )
                            }
                          />
                        </label>
                        <label className="block text-xs text-theme-text-secondary">
                          CR category
                          <input
                            type="text"
                            className={`${input} mt-1 font-mono`}
                            value={item.values["CR category"]}
                            disabled={locked || item.excluded}
                            onChange={(e) =>
                              updateField(
                                item.id,
                                "CR category",
                                e.target.value
                              )
                            }
                          />
                        </label>
                      </div>

                      <details className="mt-3 rounded-lg border border-theme-sidebar-border p-3 text-xs">
                        <summary className="cursor-pointer text-theme-text-secondary">
                          {tr("more_columns")}
                        </summary>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {EXTRA_COLUMNS.map((col) => (
                            <label
                              key={col}
                              className="block text-xs text-theme-text-secondary"
                            >
                              {col}
                              <input
                                type="text"
                                className={`${input} mt-1 font-mono`}
                                value={item.values[col]}
                                disabled={locked || item.excluded}
                                onChange={(e) =>
                                  updateField(item.id, col, e.target.value)
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </details>

                      <label className="mt-3 inline-flex items-center gap-2 text-sm text-theme-text-secondary">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-cyan-600"
                          checked={item.excluded}
                          disabled={locked}
                          onChange={(e) =>
                            toggleExcluded(item.id, e.target.checked)
                          }
                        />
                        {t("local_tools.exclude")}
                      </label>
                    </>
                  )}
                </article>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-theme-sidebar-border pt-4">
                <p className="max-w-xl text-sm leading-6 text-theme-text-secondary">
                  {tr("export_hint")}
                </p>
                <button
                  type="button"
                  className={`${primary} flex items-center gap-2`}
                  disabled={locked || !activeItems.length}
                  onClick={handleExport}
                >
                  <DownloadSimple size={18} />
                  {tr("export_excel", { count: activeItems.length })}
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
