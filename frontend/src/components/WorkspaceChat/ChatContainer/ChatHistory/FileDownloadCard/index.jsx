import { memo, useState } from "react";
import { saveAs } from "file-saver";
import { DownloadSimple, CircleNotch } from "@phosphor-icons/react";
import { humanFileSize } from "@/utils/numbers";
import StorageFiles from "@/models/files";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import { useTranslation } from "react-i18next";

/**
 * @param {{content: {filename: string, storageFilename?: string, fileSize?: number}}} props
 */
function FileDownloadCard({ props }) {
  const { t } = useTranslation();
  const {
    filename,
    storageFilename,
    fileSize,
    workspaceSlug,
    path: workspacePath,
    archive = false,
  } = props.content || {};
  const { badge, badgeBg, badgeText, fileType } = getFileDisplayInfo(
    filename,
    t
  );
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    if (!storageFilename && !(workspaceSlug && workspacePath)) return;

    setDownloading(true);
    try {
      const blob =
        props.outputType === "workspaceFile"
          ? await (archive ? Workspace.downloadFolder : Workspace.downloadFile)(
              workspaceSlug,
              workspacePath
            )
          : await StorageFiles.download(storageFilename);
      if (!blob) throw new Error("Failed to download file");
      saveAs(blob, filename || storageFilename || workspacePath);
    } catch {
      showToast(t("chat_window.file_download.download_error"), "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex justify-center w-full my-2">
      <div className="w-full max-w-[750px]">
        <div className="flex items-center justify-between gap-3 border border-theme-sidebar-border bg-theme-bg-container rounded-xl p-3">
          <div className="flex items-center gap-x-3 min-w-0">
            <div
              className={`${badgeBg} ${badgeText} rounded-lg flex items-center justify-center flex-shrink-0 h-[48px] w-[48px] text-xs font-bold`}
            >
              {badge}
            </div>
            <div className="flex flex-col min-w-0">
              <p
                title={filename}
                className="text-theme-text-primary text-sm font-medium break-all leading-snug"
              >
                {filename || t("chat_window.file_download.unknown")}
              </p>
              <p className="text-theme-text-secondary text-xs leading-snug mt-1">
                {archive
                  ? t("chat_window.file_download.folder_hint")
                  : [
                      typeof fileSize === "number"
                        ? humanFileSize(fileSize, true, 1)
                        : null,
                      fileType,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={
              downloading ||
              (!storageFilename && !(workspaceSlug && workspacePath))
            }
            aria-label={t("chat_window.file_download.download_named", {
              name: filename,
            })}
            className="flex min-h-10 items-center gap-x-2 px-3 py-2 rounded-lg border border-theme-sidebar-border hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button transition-colors text-theme-text-primary text-sm font-medium flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? (
              <CircleNotch size={16} weight="bold" className="animate-spin" />
            ) : (
              <DownloadSimple size={16} weight="bold" />
            )}
            <span>
              {downloading
                ? t("chat_window.file_download.downloading")
                : t("chat_window.file_download.download")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Get display info for a file based on its extension
 * @param {string} filename
 * @param {(key: string) => string} t
 * @returns {{badge: string, badgeBg: string, badgeText: string, fileType: string}}
 */
function getFileDisplayInfo(filename, t) {
  const extension = filename?.split(".")?.pop()?.toLowerCase() ?? "txt";
  switch (extension) {
    case "pptx":
    case "ppt":
      return {
        badge: "PPT",
        badgeBg: "bg-orange-100",
        badgeText: "text-orange-700",
        fileType: t("chat_window.file_download.types.powerpoint"),
      };
    case "pdf":
      return {
        badge: "PDF",
        badgeBg: "bg-red-100",
        badgeText: "text-red-700",
        fileType: t("chat_window.file_download.types.pdf"),
      };
    case "doc":
    case "docx":
      return {
        badge: "DOC",
        badgeBg: "bg-blue-100",
        badgeText: "text-blue-700",
        fileType: t("chat_window.file_download.types.word"),
      };
    case "xls":
    case "xlsx":
      return {
        badge: "XLS",
        badgeBg: "bg-green-100",
        badgeText: "text-green-700",
        fileType: t("chat_window.file_download.types.spreadsheet"),
      };
    case "csv":
      return {
        badge: "CSV",
        badgeBg: "bg-green-100",
        badgeText: "text-green-700",
        fileType: t("chat_window.file_download.types.spreadsheet"),
      };
    case "zip":
      return {
        badge: "ZIP",
        badgeBg: "bg-violet-100",
        badgeText: "text-violet-700",
        fileType: t("chat_window.file_download.types.zip"),
      };
    default:
      return {
        badge: extension.toUpperCase().slice(0, 4),
        badgeBg: "bg-slate-200",
        badgeText: "text-slate-700",
        fileType: t("chat_window.file_download.types.generic"),
      };
  }
}

export default memo(FileDownloadCard);
