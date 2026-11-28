import {
  ArrowLeft,
  CircleNotch,
  DownloadSimple,
  FileText,
} from "@phosphor-icons/react";
import { userFacingErrorKey } from "@/utils/userFacingError.ts";
import {
  formatSize,
  type FilePreviewData,
  type TranslateFn,
  type WorkspaceFileEntry,
} from "./types";

interface MessageStateProps {
  message: string;
  tone?: "normal" | "error";
  loading?: boolean;
}

function MessageState({
  message,
  tone = "normal",
  loading = false,
}: MessageStateProps) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center px-8 text-center">
      {loading ? (
        <CircleNotch
          size={22}
          className="animate-spin text-theme-text-secondary"
        />
      ) : (
        <FileText
          size={24}
          className={
            tone === "error" ? "text-red-400" : "text-theme-text-secondary"
          }
        />
      )}
      <p
        className={`mt-3 text-sm ${tone === "error" ? "text-red-300 light:text-red-700" : "text-theme-text-secondary"}`}
      >
        {message}
      </p>
    </div>
  );
}

interface FilePreviewPaneProps {
  selectedFile: FilePreviewData;
  previewLoading: boolean;
  error: string | null;
  downloadingPath: string | null;
  onBack: () => void;
  onDownload: (entry: WorkspaceFileEntry) => void;
  t: TranslateFn;
}

export function FilePreviewPane({
  selectedFile,
  previewLoading,
  error,
  downloadingPath,
  onBack,
  onDownload,
  t,
}: FilePreviewPaneProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-2 border-b border-theme-sidebar-border px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("chat_window.workspace_files.back")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            {selectedFile.name}
          </p>
          <p className="truncate text-[10px] text-theme-text-secondary">
            {formatSize(selectedFile.size)} · {selectedFile.path}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onDownload({
              name: selectedFile.name,
              path: selectedFile.path,
              size: selectedFile.size,
              type: "file",
            })
          }
          disabled={Boolean(downloadingPath)}
          title={t("chat_window.workspace_files.download")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary disabled:opacity-40"
        >
          <DownloadSimple size={16} />
        </button>
      </div>
      <div className="sidebar-scrollbar min-h-0 flex-1 overflow-auto">
        {previewLoading ? (
          <MessageState message={t("workspace_list.loading")} loading />
        ) : error ? (
          <MessageState message={t(userFacingErrorKey(error))} tone="error" />
        ) : selectedFile.kind === "image" ? (
          <div className="flex min-h-full items-center justify-center p-4">
            <img
              src={`data:${selectedFile.mime};base64,${selectedFile.content}`}
              alt={selectedFile.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : selectedFile.kind === "text" ? (
          <>
            <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-[1.65] text-theme-text-primary selection:bg-cyan-500/20">
              {selectedFile.content || " "}
            </pre>
            {selectedFile.truncated && (
              <p className="m-3 mt-0 border-l-2 border-amber-400 px-3 py-1.5 text-xs text-amber-300 light:text-amber-700">
                {t("chat_window.workspace_files.preview_truncated")}
              </p>
            )}
          </>
        ) : (
          <MessageState
            message={
              selectedFile.kind === "too_large"
                ? t("chat_window.workspace_files.too_large")
                : t("chat_window.workspace_files.binary")
            }
          />
        )}
      </div>
    </div>
  );
}
