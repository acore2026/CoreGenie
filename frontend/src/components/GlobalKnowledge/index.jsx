import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleNotch,
  DownloadSimple,
  FileText,
  MagnifyingGlass,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { saveAs } from "file-saver";
import System from "@/models/system";
import showToast from "@/utils/toast";

const control =
  "flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-md px-2 text-sm text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-wait disabled:opacity-50";

export default function GlobalKnowledgeWindow({ onClose }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={t("globalKnowledge.title")}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 m-auto h-[min(720px,90dvh)] max-h-[90dvh] w-[min(880px,calc(100vw-24px))] max-w-none overflow-hidden rounded-xl border border-theme-sidebar-border bg-theme-bg-chat p-0 text-theme-text-primary backdrop:bg-black/40"
    >
      <GlobalKnowledgeContent onClose={onClose} onBusyChange={setBusy} />
    </dialog>
  );
}

export function GlobalKnowledgeContent({ onClose, onBusyChange }) {
  const { t } = useTranslation();
  const input = useRef(null);
  const operation = useRef(false);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setDocuments(await System.globalKnowledge());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(files) {
    if (!files.length || operation.current) return;
    operation.current = true;
    onBusyChange?.(true);
    try {
      for (const [index, file] of files.entries()) {
        setUploading({
          name: file.name,
          index: index + 1,
          total: files.length,
        });
        try {
          await System.uploadGlobalKnowledge(file);
          showToast(
            t("globalKnowledge.uploadSuccess", { name: file.name }),
            "success"
          );
        } catch {
          showToast(
            t("globalKnowledge.uploadFailure", { name: file.name }),
            "error"
          );
        }
      }
      await load();
    } finally {
      operation.current = false;
      onBusyChange?.(false);
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  async function download(document) {
    if (downloading !== null) return;
    setDownloading(document.id);
    try {
      saveAs(
        await System.downloadGlobalKnowledge(document.id),
        document.downloadName || document.title
      );
    } catch {
      showToast(t("globalKnowledge.downloadFailure"), "error");
    } finally {
      setDownloading(null);
    }
  }

  async function remove(document) {
    if (!document.canDelete || deleting !== null) return;
    setDeleting(document.id);
    try {
      await System.removeGlobalKnowledge(document.id);
      setDocuments((current) =>
        current.filter((item) => item.id !== document.id)
      );
      setConfirm(null);
      showToast(
        t("globalKnowledge.removeSuccess", { name: document.title }),
        "success"
      );
    } catch {
      showToast(t("globalKnowledge.removeFailure"), "error");
    } finally {
      setDeleting(null);
    }
  }

  const filtered = documents.filter(
    (document) =>
      (!mine || document.canDelete) &&
      `${document.title} ${document.uploadedBy || ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex shrink-0 items-start gap-4 px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-theme-text-primary">
            {t("globalKnowledge.title")}
          </h1>
          <p className="mt-1 text-xs leading-5 text-theme-text-secondary">
            {t("globalKnowledge.sharedHint")}
          </p>
        </div>
        <button
          type="button"
          className={control}
          onClick={onClose}
          disabled={!!uploading}
          aria-label={t("globalKnowledge.close")}
        >
          <X size={20} />
        </button>
      </header>

      <div className="shrink-0 px-5 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-3 text-theme-text-secondary"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("globalKnowledge.search")}
              placeholder={t("globalKnowledge.search")}
              className="h-10 w-full rounded-md border border-theme-sidebar-border bg-theme-bg-container pl-9 pr-3 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:outline-none focus:ring-2 focus:ring-primary-button"
            />
          </div>
          <button
            type="button"
            disabled={!!uploading}
            onClick={() => input.current?.click()}
            className="flex h-10 shrink-0 items-center gap-2 rounded-md bg-primary-button px-3 text-sm font-medium text-white hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
          >
            {uploading ? (
              <CircleNotch size={16} className="animate-spin" />
            ) : (
              <UploadSimple size={16} />
            )}
            {t("globalKnowledge.upload")}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            disabled={!!uploading}
            hidden
            onChange={(event) => upload([...event.target.files])}
          />
        </div>
        <div
          className="mt-4 flex items-center gap-4 border-b border-theme-sidebar-border"
          aria-label={t("globalKnowledge.filter")}
        >
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={mine === value}
              onClick={() => setMine(value)}
              className={`h-10 border-b-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button ${mine === value ? "border-primary-button font-medium text-theme-text-primary" : "border-transparent text-theme-text-secondary hover:text-theme-text-primary"}`}
            >
              {t(value ? "globalKnowledge.mine" : "globalKnowledge.all")}
            </button>
          ))}
          {!loading && !error && (
            <span className="ml-auto text-xs tabular-nums text-theme-text-secondary">
              {t("globalKnowledge.documentCount", { count: filtered.length })}
            </span>
          )}
        </div>
      </div>

      {uploading && (
        <p
          role="status"
          className="shrink-0 break-words border-b border-theme-sidebar-border px-5 py-3 text-xs text-theme-text-secondary sm:px-7"
        >
          {t("globalKnowledge.progress", uploading)}
        </p>
      )}
      <section
        aria-label={t("globalKnowledge.documents")}
        aria-busy={loading}
        className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-7"
      >
        {loading ? (
          <p
            role="status"
            className="py-16 text-center text-sm text-theme-text-secondary"
          >
            {t("globalKnowledge.loading")}
          </p>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 py-16 text-sm text-theme-text-secondary"
          >
            <p>{t("globalKnowledge.loadFailure")}</p>
            <button type="button" className={control} onClick={load}>
              {t("globalKnowledge.retry")}
            </button>
          </div>
        ) : !filtered.length ? (
          <div className="py-16 text-center text-sm text-theme-text-secondary">
            <FileText size={28} className="mx-auto mb-3" />
            <p>
              {t(
                query
                  ? "globalKnowledge.noMatch"
                  : mine
                    ? "globalKnowledge.mineEmpty"
                    : "globalKnowledge.empty"
              )}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-theme-sidebar-border">
            {filtered.map((document) => (
              <li key={document.id} className="py-3">
                <div className="flex items-center gap-3">
                  <FileText
                    size={20}
                    className="hidden shrink-0 text-theme-text-secondary sm:block"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      title={document.title}
                      className="break-words text-sm font-medium text-theme-text-primary [overflow-wrap:anywhere]"
                    >
                      {document.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-theme-text-secondary">
                      {document.canDelete
                        ? t("globalKnowledge.you")
                        : document.uploadedBy || t("globalKnowledge.legacy")}
                      <span className="mx-2" aria-hidden="true">
                        ·
                      </span>
                      {new Date(document.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={control}
                    disabled={downloading !== null}
                    onClick={() => download(document)}
                    aria-label={`${t("globalKnowledge.download")} ${document.title}`}
                    title={t("globalKnowledge.download")}
                  >
                    {downloading === document.id ? (
                      <CircleNotch size={18} className="animate-spin" />
                    ) : (
                      <DownloadSimple size={18} />
                    )}
                  </button>
                  {document.canDelete && (
                    <button
                      type="button"
                      className={control}
                      disabled={deleting !== null}
                      onClick={() => setConfirm(document.id)}
                      aria-label={`${t("globalKnowledge.remove")} ${document.title}`}
                      title={t("globalKnowledge.remove")}
                    >
                      <Trash size={18} />
                    </button>
                  )}
                </div>
                {confirm === document.id && (
                  <div
                    className="mt-3 rounded-md border border-theme-sidebar-border p-3"
                    role="group"
                    aria-label={t("globalKnowledge.confirmDelete")}
                  >
                    <p className="break-words text-xs leading-5 text-theme-text-secondary">
                      {t("globalKnowledge.removeConfirm", {
                        name: document.title,
                      })}
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        className={control}
                        disabled={deleting !== null}
                        onClick={() => setConfirm(null)}
                      >
                        {t("globalKnowledge.cancel")}
                      </button>
                      <button
                        type="button"
                        className={`${control} !text-red-500`}
                        disabled={deleting !== null}
                        onClick={() => remove(document)}
                      >
                        {deleting === document.id ? (
                          <CircleNotch size={16} className="animate-spin" />
                        ) : (
                          t("globalKnowledge.confirmDelete")
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="shrink-0 border-t border-theme-sidebar-border px-5 py-3 text-xs leading-5 text-theme-text-secondary sm:px-7">
        {t("globalKnowledge.accessHint")}
      </footer>
    </div>
  );
}
