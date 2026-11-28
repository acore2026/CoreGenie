import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { isMobile } from "react-device-detect";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  CloudArrowDown,
  DownloadSimple,
  FileDoc,
  FileXls,
  X,
} from "@phosphor-icons/react";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import paths from "@/utils/paths";
import { LIMITS, LocalToolError } from "@/utils/localTools/proposalFill";
import {
  BaselineDownloadError,
  downloadOfficialBaseline,
} from "@/utils/localTools/baselineDownload";
import {
  readFileBytes,
  triggerBrowserDownload,
} from "@/utils/localTools/ooxml";
import {
  applyBaselinesToDrafts,
  buildReasonForChangeParagraphs,
  computeNextApiVersion,
  computeNextTsVersion,
  crOutputFilename,
  generateApiUpdateCrDocx,
  packageGeneratedCrs,
  readApiImpactsWorkbook,
  readBaselineSpec,
  type ApiCrGenerationConfig,
  type ApiImpactsWorkbookResult,
  type ApiUpdateCrDraft,
  type BaselineSpecData,
  type BodyStyleMode,
  type ImpactedApiDraft,
} from "@/utils/localTools/apiImpactCr";
import type { ExportFile } from "@/utils/localTools/types";
import { control, input, primary } from "./proposalControls";
import ToolLogo from "./ToolLogo";

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function defaultConfig(): ApiCrGenerationConfig {
  const now = new Date();
  const year = String(now.getFullYear());
  const yy = year.slice(-2);
  return {
    meetingHeader: "3GPP TSG-CT WG3 Meeting #150",
    meetingLocationDate: "",
    tdocPlaceholder: `C3-${yy}xxxx`,
    sourceToWg: "Huawei",
    sourceToTsg: "C3",
    date: now.toISOString().slice(0, 10),
    copyrightYear: year,
    bodyMode: "full_yaml",
    author: "Huawei",
  };
}

export default function ApiCrGenerator({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, params?: Record<string, string | number>) =>
    String(t(`local_tools.api_cr.${key}`, params));

  const [workbook, setWorkbook] = useState<ApiImpactsWorkbookResult | null>(
    null
  );
  const [drafts, setDrafts] = useState<ApiUpdateCrDraft[]>([]);
  const [baselines, setBaselines] = useState<BaselineSpecData[]>([]);
  const [customTemplate, setCustomTemplate] = useState<{
    name: string;
    bytes: Uint8Array;
  } | null>(null);
  const [config, setConfig] = useState<ApiCrGenerationConfig>(defaultConfig);
  const [specFilter, setSpecFilter] = useState("");
  const [releaseFilter, setReleaseFilter] = useState("all");
  const [busy, setBusy] = useState<"" | "reading" | "exporting">("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const operation = useRef(false);

  const excelRef = useRef<HTMLInputElement>(null);
  const baselineRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const locked = Boolean(busy);

  const errorText = (err: unknown): string => {
    if (err instanceof LocalToolError) {
      const apiKey = `local_tools.api_cr.errors.${err.code}`;
      const apiMsg = String(t(apiKey, { ...err.params, defaultValue: "" }));
      if (apiMsg) return apiMsg;
      return String(t(`local_tools.errors.${err.code}`, err.params));
    }
    return String(t("local_tools.errors.read_failed"));
  };

  const releases = useMemo(() => {
    return [...new Set(drafts.map((d) => d.release))].sort();
  }, [drafts]);

  const visibleDrafts = useMemo(() => {
    const tokens = specFilter
      .split(/[\s,;，；]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return drafts.filter((draft) => {
      if (releaseFilter !== "all" && draft.release !== releaseFilter) {
        return false;
      }
      if (!tokens.length) return true;
      const haystack = `${draft.spec} ${draft.release} ${draft.apis
        .map((a) => `${a.apiName} ${a.yamlFile}`)
        .join(" ")}`.toLowerCase();
      return tokens.some((tok) => haystack.includes(tok));
    });
  }, [drafts, specFilter, releaseFilter]);

  const selectedVisible = useMemo(
    () => visibleDrafts.filter((d) => d.selected),
    [visibleDrafts]
  );

  const selectedMissingBaseline = useMemo(
    () => selectedVisible.filter((d) => !d.baselineFileName),
    [selectedVisible]
  );

  async function handleSelectExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || operation.current) return;
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      setProgress(tr("reading_excel"));
      await pause();
      const parsed = await readApiImpactsWorkbook(file);
      setWorkbook(parsed);
      setDrafts(applyBaselinesToDrafts(parsed.drafts, baselines));
      setReleaseFilter("all");
    } catch (err) {
      setError(errorText(err));
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  async function handleSelectBaselines(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files || [])].filter(
      (f) => /\.(docx|ya?ml)$/i.test(f.name) && !f.name.startsWith("~$")
    );
    event.target.value = "";
    if (!chosen.length || operation.current) return;
    if (baselines.length + chosen.length > LIMITS.files) {
      setError(String(t("local_tools.errors.batch_count")));
      return;
    }
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      const additions: BaselineSpecData[] = [];
      for (let i = 0; i < chosen.length; i++) {
        setProgress(
          tr("reading_baseline", { current: i + 1, total: chosen.length })
        );
        await pause();
        additions.push(await readBaselineSpec(chosen[i]));
      }
      const nextBaselines = [...baselines, ...additions];
      setBaselines(nextBaselines);
      if (drafts.length) {
        setDrafts((curr) => applyBaselinesToDrafts(curr, nextBaselines));
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  function mergeBaselineIntoList(
    current: BaselineSpecData[],
    incoming: BaselineSpecData
  ): BaselineSpecData[] {
    const filtered = current.filter(
      (b) =>
        !(
          b.spec &&
          b.release &&
          b.spec === incoming.spec &&
          b.release === incoming.release
        )
    );
    return [...filtered, incoming];
  }

  async function fetchOfficialBaselines(targets: ApiUpdateCrDraft[]) {
    if (!targets.length || operation.current) return;
    operation.current = true;
    setBusy("reading");
    setError("");
    setNotice("");
    let nextBaselines = [...baselines];
    let succeeded = 0;
    const failures: string[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const draft = targets[i];
        setProgress(
          tr("fetching_official_progress", {
            current: i + 1,
            total: targets.length,
            spec: draft.spec,
            release: draft.release,
          })
        );
        await pause();
        try {
          const downloaded = await downloadOfficialBaseline(
            draft.spec,
            draft.release
          );
          const parsed = await readBaselineSpec(downloaded.file);
          const enriched: BaselineSpecData = {
            ...parsed,
            spec: parsed.spec || downloaded.spec,
            release: parsed.release || downloaded.release,
            currentTsVersion: parsed.currentTsVersion || downloaded.version,
            source: downloaded.source,
            fetchedAt: downloaded.fetchedAt,
          };
          nextBaselines = mergeBaselineIntoList(nextBaselines, enriched);
          setBaselines(nextBaselines);
          setDrafts((curr) => applyBaselinesToDrafts(curr, nextBaselines));
          succeeded += 1;
        } catch (err) {
          const reason =
            err instanceof BaselineDownloadError ? err.message : errorText(err);
          failures.push(`TS ${draft.spec} ${draft.release}：${reason}`);
        }
      }
      if (succeeded > 0) {
        setNotice(
          failures.length
            ? tr("fetch_official_partial", {
                succeeded,
                failed: failures.length,
              })
            : tr("fetch_official_done", { count: succeeded })
        );
      }
      if (failures.length) {
        setError(failures.join("；"));
      }
    } finally {
      operation.current = false;
      setBusy("");
      setProgress("");
    }
  }

  function removeBaseline(id: string) {
    const next = baselines.filter((b) => b.id !== id);
    setBaselines(next);
    if (workbook) {
      setDrafts(applyBaselinesToDrafts(workbook.drafts, next));
    }
    setNotice("");
  }

  function clearAll() {
    setWorkbook(null);
    setDrafts([]);
    setSpecFilter("");
    setReleaseFilter("all");
    setError("");
    setNotice("");
  }

  function updateDraft(id: string, patch: Partial<ApiUpdateCrDraft>) {
    setNotice("");
    setDrafts((curr) =>
      curr.map((d) => {
        if (d.id !== id) return d;
        const next: ApiUpdateCrDraft = { ...d, ...patch };
        if (
          patch.currentTsVersion !== undefined &&
          patch.targetTsVersion === undefined
        ) {
          const computed = computeNextTsVersion(patch.currentTsVersion);
          if (computed) next.targetTsVersion = computed;
        }
        if (patch.isDraftRelease !== undefined) {
          next.apis = next.apis.map((api) => ({
            ...api,
            targetApiVersion:
              computeNextApiVersion(
                api.currentApiVersion,
                api.highestImpact,
                next.isDraftRelease
              ) || api.targetApiVersion,
          }));
        }
        return next;
      })
    );
  }

  function updateApi(
    draftId: string,
    yamlFile: string,
    patch: Partial<ImpactedApiDraft>
  ) {
    setNotice("");
    setDrafts((curr) =>
      curr.map((d) => {
        if (d.id !== draftId) return d;
        const apis = d.apis.map((api) => {
          if (api.yamlFile !== yamlFile) return api;
          const nextApi: ImpactedApiDraft = { ...api, ...patch };
          if (
            patch.currentApiVersion !== undefined &&
            patch.targetApiVersion === undefined
          ) {
            const computed = computeNextApiVersion(
              patch.currentApiVersion,
              nextApi.highestImpact,
              d.isDraftRelease
            );
            if (computed) nextApi.targetApiVersion = computed;
          }
          return nextApi;
        });
        const clauses =
          patch.clause !== undefined
            ? [...new Set(apis.map((a) => a.clause).filter(Boolean))].join(", ")
            : d.clausesAffected;
        return { ...d, apis, clausesAffected: clauses };
      })
    );
  }

  function toggleVisibleSelection(selected: boolean) {
    const visibleIds = new Set(visibleDrafts.map((d) => d.id));
    setDrafts((curr) =>
      curr.map((d) => (visibleIds.has(d.id) ? { ...d, selected } : d))
    );
  }

  async function handleSelectCustomTemplate(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || operation.current) return;
    setError("");
    setNotice("");
    try {
      const bytes = await readFileBytes(file, ".docx");
      setCustomTemplate({ name: file.name, bytes });
    } catch (err) {
      setError(errorText(err));
    }
  }

  function exportSingle(draft: ApiUpdateCrDraft) {
    setError("");
    try {
      const bytes = generateApiUpdateCrDocx(
        draft,
        config,
        customTemplate?.bytes ?? null
      );
      const name = crOutputFilename(draft, config.tdocPlaceholder);
      triggerBrowserDownload(
        bytes,
        name,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      setNotice(tr("export_single_done", { name }));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function exportSelectedZip() {
    if (operation.current || !selectedVisible.length) return;
    operation.current = true;
    setBusy("exporting");
    setError("");
    setNotice("");
    try {
      const files: ExportFile[] = [];
      const report: Record<string, unknown>[] = [];
      for (let i = 0; i < selectedVisible.length; i++) {
        const draft = selectedVisible[i];
        setProgress(
          tr("export_progress", {
            current: i + 1,
            total: selectedVisible.length,
          })
        );
        await pause();
        const name = crOutputFilename(draft, config.tdocPlaceholder);
        const bytes = generateApiUpdateCrDocx(
          draft,
          config,
          customTemplate?.bytes ?? null
        );
        files.push({ name, bytes });
        report.push({
          规范: draft.spec,
          Release: draft.release,
          文件名: name,
          当前规范版本: draft.currentTsVersion,
          目标规范版本: draft.targetTsVersion,
          受影响条款: draft.clausesAffected,
          受影响API数: draft.apis.length,
          基线文件: draft.baselineFileName || "未上传（使用占位模板）",
        });
      }
      const zipBytes = packageGeneratedCrs(files, report);
      triggerBrowserDownload(
        zipBytes,
        "3GPP-API-Update-CRs.zip",
        "application/zip"
      );
      setNotice(tr("export_zip_done", { count: files.length }));
    } catch (err) {
      setError(errorText(err));
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
                  to={paths.tdocAllocation()}
                  className={`${control} inline-flex items-center gap-2 text-theme-text-secondary`}
                >
                  {tr("next_step_link")}
                  <ArrowRight size={16} />
                </Link>
              </div>
            )}
            <div className="mt-4 flex items-start gap-3.5">
              <ToolLogo tool="api-cr-generator" size="md" />
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
                      name: t("local_tools.contributors.api-cr-generator"),
                    })}
                  </span>
                </p>
              </div>
            </div>
          </header>

          <section
            className="grid gap-4 md:grid-cols-2"
            aria-label={tr("upload_section")}
          >
            <div className="rounded-xl border border-theme-sidebar-border p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <FileXls size={21} />
                {tr("step1_title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
                {tr("step1_hint")}
              </p>
              <input
                ref={excelRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                aria-label={tr("choose_impacts")}
                onChange={handleSelectExcel}
                disabled={locked}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => excelRef.current?.click()}
                >
                  {tr("choose_impacts")}
                </button>
                {workbook && (
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={clearAll}
                  >
                    {tr("clear_impacts")}
                  </button>
                )}
              </div>
              {workbook && (
                <div className="mt-3 rounded-lg border border-theme-sidebar-border p-3 text-sm">
                  <p className="break-all font-medium">{workbook.fileName}</p>
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    {tr("impacts_loaded", {
                      sheets: workbook.sheetsRead.join("、"),
                      rows: workbook.sourceRowCount,
                      crs: drafts.length,
                    })}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-theme-sidebar-border p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <FileDoc size={21} />
                {tr("step2_title")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
                {tr("step2_hint")}
              </p>
              <input
                ref={baselineRef}
                type="file"
                accept=".docx,.yaml,.yml"
                multiple
                className="hidden"
                aria-label={tr("choose_baselines")}
                onChange={handleSelectBaselines}
                disabled={locked}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${control} inline-flex items-center gap-1.5`}
                  disabled={locked || !selectedVisible.length}
                  onClick={() =>
                    fetchOfficialBaselines(
                      selectedMissingBaseline.length
                        ? selectedMissingBaseline
                        : selectedVisible
                    )
                  }
                >
                  <CloudArrowDown size={16} />
                  {tr("fetch_official_selected", {
                    count: selectedMissingBaseline.length
                      ? selectedMissingBaseline.length
                      : selectedVisible.length,
                  })}
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={locked}
                  onClick={() => baselineRef.current?.click()}
                >
                  {tr("choose_baselines")}
                </button>
              </div>
              {baselines.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {baselines.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-theme-sidebar-border p-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="break-all text-sm font-medium">
                          {b.fileName}
                        </p>
                        <p className="mt-0.5 text-theme-text-secondary">
                          {b.spec || tr("unknown_spec")}
                          {b.release ? ` · ${b.release}` : ""}
                          {b.currentTsVersion
                            ? ` · V${b.currentTsVersion}`
                            : ""}
                          {" · "}
                          {tr("baseline_api_count", { count: b.apis.length })}
                        </p>
                        {b.source && (
                          <p className="mt-0.5 break-all text-theme-text-secondary">
                            <a
                              href={b.source}
                              target="_blank"
                              rel="noreferrer"
                              className="underline focus-visible:ring-2 focus-visible:ring-primary-button"
                            >
                              {tr("official_archive_source")}
                            </a>
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className={control}
                        disabled={locked}
                        aria-label={tr("remove_baseline", { name: b.fileName })}
                        onClick={() => removeBaseline(b.id)}
                      >
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section
            className="rounded-xl border border-theme-sidebar-border p-5"
            aria-label={tr("config_title")}
          >
            <h2 className="font-medium">{tr("config_title")}</h2>
            <p className="mt-1 text-sm text-theme-text-secondary">
              {tr("config_hint")}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm">
                {tr("meeting_header")}
                <input
                  type="text"
                  className={`${input} mt-1.5`}
                  value={config.meetingHeader}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, meetingHeader: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                {tr("meeting_location")}
                <input
                  type="text"
                  className={`${input} mt-1.5`}
                  placeholder="Calgary, Canada, 16th – 20th November, 2026"
                  value={config.meetingLocationDate}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      meetingLocationDate: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="block text-sm">
                {tr("tdoc_placeholder")}
                <input
                  type="text"
                  className={`${input} mt-1.5 font-mono`}
                  value={config.tdocPlaceholder}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      tdocPlaceholder: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="block text-sm">
                {tr("source_wg")}
                <input
                  type="text"
                  className={`${input} mt-1.5`}
                  value={config.sourceToWg}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      sourceToWg: e.target.value,
                      author: e.target.value || c.author,
                    }))
                  }
                />
              </label>
              <label className="block text-sm">
                {tr("source_tsg")}
                <input
                  type="text"
                  className={`${input} mt-1.5`}
                  value={config.sourceToTsg}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, sourceToTsg: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                {tr("body_mode")}
                <select
                  className={`${input} mt-1.5`}
                  value={config.bodyMode}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      bodyMode: e.target.value as BodyStyleMode,
                    }))
                  }
                >
                  <option value="full_yaml">{tr("body_full_yaml")}</option>
                  <option value="header_only">{tr("body_header_only")}</option>
                </select>
              </label>
              <label className="block text-sm">
                {tr("cr_date")}
                <input
                  type="date"
                  className={`${input} mt-1.5`}
                  value={config.date}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, date: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                {tr("copyright_year")}
                <input
                  type="text"
                  className={`${input} mt-1.5 font-mono`}
                  value={config.copyrightYear}
                  disabled={locked}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, copyrightYear: e.target.value }))
                  }
                />
              </label>
              <div className="block text-sm">
                <span>{tr("cr_template")}</span>
                <input
                  ref={templateRef}
                  type="file"
                  accept=".docx"
                  className="hidden"
                  aria-label={tr("choose_cr_template")}
                  onChange={handleSelectCustomTemplate}
                  disabled={locked}
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={() => templateRef.current?.click()}
                  >
                    {tr("choose_cr_template")}
                  </button>
                  {customTemplate && (
                    <button
                      type="button"
                      className={control}
                      disabled={locked}
                      onClick={() => setCustomTemplate(null)}
                    >
                      {tr("reset_cr_template")}
                    </button>
                  )}
                </div>
                <p className="mt-1 break-all text-xs text-theme-text-secondary">
                  {customTemplate
                    ? tr("custom_cr_template_loaded", {
                        name: customTemplate.name,
                      })
                    : tr("default_cr_template_hint")}
                </p>
              </div>
            </div>
          </section>

          <details className="rounded-lg border border-theme-sidebar-border p-4 text-sm">
            <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button">
              {tr("rules_title")}
            </summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-6 text-theme-text-secondary">
              {(
                t("local_tools.api_cr.rules", {
                  returnObjects: true,
                }) as string[]
              ).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
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
              {progress}
            </p>
          )}

          {drafts.length > 0 ? (
            <section
              aria-labelledby="api-cr-list-heading"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2
                    id="api-cr-list-heading"
                    className="text-lg font-semibold"
                  >
                    {tr("preview_heading", {
                      visible: visibleDrafts.length,
                      total: drafts.length,
                    })}
                  </h2>
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    {tr("selected_summary", { count: selectedVisible.length })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={() => toggleVisibleSelection(true)}
                  >
                    {tr("select_all")}
                  </button>
                  <button
                    type="button"
                    className={control}
                    disabled={locked}
                    onClick={() => toggleVisibleSelection(false)}
                  >
                    {tr("deselect_all")}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm sm:col-span-2">
                  {tr("filter_spec")}
                  <input
                    type="text"
                    className={`${input} mt-1.5`}
                    placeholder={tr("filter_spec_placeholder")}
                    value={specFilter}
                    onChange={(e) => setSpecFilter(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  {tr("filter_release")}
                  <select
                    className={`${input} mt-1.5`}
                    value={releaseFilter}
                    onChange={(e) => setReleaseFilter(e.target.value)}
                  >
                    <option value="all">{tr("all_releases")}</option>
                    {releases.map((rel) => (
                      <option key={rel} value={rel}>
                        {rel}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {visibleDrafts.map((draft) => {
                const reasonPreview =
                  buildReasonForChangeParagraphs(draft).join("\n");
                return (
                  <article
                    key={draft.id}
                    className={`rounded-xl border border-theme-sidebar-border p-4 md:p-5 ${draft.selected ? "" : "opacity-60"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <label className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-cyan-600"
                          checked={draft.selected}
                          disabled={locked}
                          onChange={(e) =>
                            updateDraft(draft.id, {
                              selected: e.target.checked,
                            })
                          }
                        />
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold">
                            TS {draft.spec} · {draft.release}
                          </h3>
                          <p className="mt-0.5 text-xs text-theme-text-secondary">
                            {tr("cr_card_meta", {
                              apis: draft.apis.length,
                              baseline:
                                draft.baselineFileName || tr("no_baseline"),
                            })}
                          </p>
                        </div>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`${control} inline-flex items-center gap-1.5`}
                          disabled={locked}
                          onClick={() => fetchOfficialBaselines([draft])}
                        >
                          <CloudArrowDown size={16} />
                          {tr("fetch_official_single")}
                        </button>
                        <button
                          type="button"
                          className={control}
                          disabled={locked}
                          onClick={() => exportSingle(draft)}
                        >
                          {tr("download_single")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="block text-xs text-theme-text-secondary">
                        {tr("current_ts_version")}
                        <input
                          type="text"
                          className={`${input} mt-1 font-mono`}
                          placeholder="20.1.0"
                          value={draft.currentTsVersion}
                          disabled={locked}
                          onChange={(e) =>
                            updateDraft(draft.id, {
                              currentTsVersion: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="block text-xs text-theme-text-secondary">
                        {tr("target_ts_version")}
                        <input
                          type="text"
                          className={`${input} mt-1 font-mono`}
                          placeholder="20.2.0"
                          value={draft.targetTsVersion}
                          disabled={locked}
                          onChange={(e) =>
                            updateDraft(draft.id, {
                              targetTsVersion: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="block text-xs text-theme-text-secondary">
                        {tr("work_item")}
                        <input
                          type="text"
                          className={`${input} mt-1 font-mono`}
                          value={draft.workItem}
                          disabled={locked}
                          onChange={(e) =>
                            updateDraft(draft.id, { workItem: e.target.value })
                          }
                        />
                      </label>
                      <label className="block text-xs text-theme-text-secondary">
                        {tr("clauses_affected")}
                        <input
                          type="text"
                          className={`${input} mt-1 font-mono`}
                          placeholder="A.2, A.3"
                          value={draft.clausesAffected}
                          disabled={locked}
                          onChange={(e) =>
                            updateDraft(draft.id, {
                              clausesAffected: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>

                    <label className="mt-3 inline-flex items-center gap-2 text-xs text-theme-text-secondary">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-cyan-600"
                        checked={draft.isDraftRelease}
                        disabled={locked}
                        onChange={(e) =>
                          updateDraft(draft.id, {
                            isDraftRelease: e.target.checked,
                          })
                        }
                      />
                      {tr("draft_release_alpha")}
                    </label>

                    <div className="mt-4 space-y-3">
                      {draft.apis.map((api) => (
                        <div
                          key={api.yamlFile}
                          className="rounded-lg border border-theme-sidebar-border p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="break-all text-sm font-medium">
                                {api.apiName}
                                <span className="ml-2 font-mono text-xs font-normal text-theme-text-secondary">
                                  {api.yamlFile}
                                </span>
                              </p>
                            </div>
                            <span className="rounded border border-theme-sidebar-border px-2 py-0.5 text-xs text-theme-text-secondary">
                              {tr(`impact_level.${api.highestImpact}`)}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <label className="block text-xs text-theme-text-secondary">
                              {tr("api_clause")}
                              <input
                                type="text"
                                className={`${input} mt-1 font-mono`}
                                placeholder="A.2"
                                value={api.clause}
                                disabled={locked}
                                onChange={(e) =>
                                  updateApi(draft.id, api.yamlFile, {
                                    clause: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="block text-xs text-theme-text-secondary">
                              {tr("api_old_version")}
                              <input
                                type="text"
                                className={`${input} mt-1 font-mono`}
                                placeholder="1.3.0-alpha.2"
                                value={api.currentApiVersion}
                                disabled={locked}
                                onChange={(e) =>
                                  updateApi(draft.id, api.yamlFile, {
                                    currentApiVersion: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="block text-xs text-theme-text-secondary">
                              {tr("api_new_version")}
                              <input
                                type="text"
                                className={`${input} mt-1 font-mono`}
                                placeholder="1.3.0-alpha.3"
                                value={api.targetApiVersion}
                                disabled={locked}
                                onChange={(e) =>
                                  updateApi(draft.id, api.yamlFile, {
                                    targetApiVersion: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>

                          <ul className="mt-2.5 space-y-1 text-xs text-theme-text-secondary">
                            {api.impacts.map((imp, idx) => (
                              <li
                                key={`${imp.sourceSpec}-${imp.sourceCr}-${idx}`}
                                className="font-mono"
                              >
                                {imp.sourceSpec}{" "}
                                {imp.sourceCr ? `CR#${imp.sourceCr}` : imp.tdoc}{" "}
                                introduces {imp.impactPhrase}
                                {imp.inferredFromCategory
                                  ? ` (${tr("inferred_note")})`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                          {api.potentiallyMissingNotes.length > 0 && (
                            <p className="mt-2 text-xs text-amber-600">
                              {tr("potentially_missing", {
                                notes: api.potentiallyMissingNotes.join("；"),
                              })}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <details className="mt-3 rounded-lg border border-theme-sidebar-border p-3 text-xs">
                      <summary className="cursor-pointer font-medium text-theme-text-secondary">
                        {tr("preview_reason")}
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words font-mono leading-5 text-theme-text-primary">
                        {reasonPreview}
                      </pre>
                    </details>
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
                  disabled={locked || !selectedVisible.length}
                  onClick={exportSelectedZip}
                >
                  <DownloadSimple size={18} />
                  {tr(busy === "exporting" ? "exporting" : "export_zip", {
                    count: selectedVisible.length,
                  })}
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
