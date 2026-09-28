import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleNotch,
  CloudArrowUp,
  DownloadSimple,
  FileText,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/SettingsSidebar";
import System from "@/models/system";
import showToast from "@/utils/toast";

export default function GlobalKnowledge() {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [error, setError] = useState("");

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDocuments(await System.globalKnowledge());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const uploadFiles = async (files) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    for (const file of files) {
      try {
        showToast(t("globalKnowledge.uploading", { name: file.name }));
        await System.uploadGlobalKnowledge(file);
        showToast(
          t("globalKnowledge.uploadSuccess", { name: file.name }),
          "success"
        );
      } catch (uploadError) {
        showToast(
          t("globalKnowledge.uploadFailed", {
            name: file.name,
            error: uploadError.message,
          }),
          "error"
        );
      }
    }
    await loadDocuments();
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeDocument = async (document) => {
    if (
      !window.confirm(
        t("globalKnowledge.removeConfirm", { name: document.title })
      )
    )
      return;
    try {
      await System.removeGlobalKnowledge(document.id);
      setDocuments((current) =>
        current.filter((item) => item.id !== document.id)
      );
      showToast(
        t("globalKnowledge.removeSuccess", { name: document.title }),
        "success"
      );
    } catch (removeError) {
      showToast(
        t("globalKnowledge.removeFailed", { error: removeError.message }),
        "error"
      );
    }
  };

  const downloadDocument = async (document) => {
    if (downloadingId !== null) return;
    setDownloadingId(document.id);
    try {
      const blob = await System.downloadGlobalKnowledge(document.id);
      saveAs(blob, document.downloadName || document.title);
    } catch (downloadError) {
      showToast(
        t("globalKnowledge.downloadFailed", { error: downloadError.message }),
        "error"
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <main className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-auto px-4 py-16 md:px-8 md:py-7">
        <div className="mx-auto w-full max-w-5xl">
          <header className="border-b-2 border-white/10 pb-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-lg leading-6 font-bold text-theme-text-primary">
                  {t("globalKnowledge.title")}
                </h1>
                <p className="mt-1 text-xs leading-[18px] text-theme-text-secondary">
                  {t("globalKnowledge.description")}
                </p>
              </div>
              <span className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs tabular-nums text-theme-text-secondary">
                {t("globalKnowledge.documentCount", {
                  count: documents.length,
                })}
              </span>
            </div>
          </header>

          <div className="mt-6 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-theme-text-secondary">
            <Warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <p className="leading-5">{t("globalKnowledge.notice")}</p>
          </div>

          <section className="mt-6 rounded-xl border border-theme-modal-border bg-theme-bg-primary p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-theme-text-primary">
                  {t("globalKnowledge.upload")}
                </h2>
                <p className="mt-1 text-xs leading-[18px] text-theme-text-secondary">
                  {t("globalKnowledge.uploadHint")}
                </p>
              </div>
              <label
                className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-button px-4 py-2 text-sm font-semibold text-white transition-[transform,background-color,opacity] duration-150 focus-within:ring-2 focus-within:ring-cyan-300/70 active:scale-[0.97] ${
                  uploading
                    ? "pointer-events-none opacity-50"
                    : "hover:bg-secondary"
                }`}
              >
                <CloudArrowUp className="h-5 w-5" weight="bold" />
                {uploading
                  ? t("globalKnowledge.processing")
                  : t("globalKnowledge.upload")}
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  disabled={uploading}
                  className="sr-only"
                  onChange={(event) => uploadFiles([...event.target.files])}
                />
              </label>
            </div>
          </section>

          <section className="mt-7">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-theme-text-primary">
                {t("globalKnowledge.documents")}
              </h2>
              {error && (
                <button
                  type="button"
                  onClick={loadDocuments}
                  className="min-h-10 rounded-lg px-3 text-xs font-semibold text-cyan-300 hover:bg-theme-action-menu-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                >
                  {t("globalKnowledge.retry")}
                </button>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-theme-modal-border bg-theme-bg-primary">
              {loading ? (
                <p className="px-4 py-10 text-center text-sm text-theme-text-secondary">
                  {t("globalKnowledge.loading")}
                </p>
              ) : error ? (
                <p className="px-4 py-10 text-center text-sm text-red-300">
                  {error}
                </p>
              ) : documents.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-theme-text-secondary">
                  {t("globalKnowledge.empty")}
                </p>
              ) : (
                <ul className="divide-y divide-white/10">
                  {documents.map((document) => (
                    <li
                      key={document.id}
                      className="flex min-h-16 items-center gap-3 px-4 py-3"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-theme-text-primary">
                          {document.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-theme-text-secondary">
                          {document.filename} ·{" "}
                          {t("globalKnowledge.addedAt", {
                            date: new Date(document.createdAt).toLocaleString(
                              "zh-CN"
                            ),
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadDocument(document)}
                        disabled={downloadingId !== null}
                        aria-label={`${t("globalKnowledge.download")} ${document.title}`}
                        title={
                          downloadingId === document.id
                            ? t("globalKnowledge.downloading")
                            : t("globalKnowledge.download")
                        }
                        className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-theme-text-secondary transition-colors hover:bg-cyan-400/10 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-wait disabled:opacity-50"
                      >
                        {downloadingId === document.id ? (
                          <CircleNotch className="h-5 w-5 animate-spin" />
                        ) : (
                          <DownloadSimple className="h-5 w-5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDocument(document)}
                        aria-label={`${t("globalKnowledge.remove")} ${document.title}`}
                        className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-theme-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/70"
                      >
                        <Trash className="h-5 w-5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
