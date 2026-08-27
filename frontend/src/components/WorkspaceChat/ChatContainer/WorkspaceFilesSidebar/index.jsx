import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowsClockwise,
  CaretRight,
  DownloadSimple,
  File,
  FileText,
  Folder,
  FileZip,
  House,
  Image as ImageIcon,
  X,
} from "@phosphor-icons/react";
import { saveAs } from "file-saver";
import Workspace from "@/models/workspace";
import { AGENT_SESSION_END } from "@/utils/chat/agent";
import { useWorkspaceFilesSidebar } from "../ChatSidebar";

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function fileIcon(entry) {
  if (entry.type === "directory")
    return <Folder size={20} weight="fill" className="text-amber-400" />;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(entry.name))
    return <ImageIcon size={20} className="text-sky-400" />;
  if (
    /\.(md|txt|json|ya?ml|toml|csv|log|jsx?|tsx?|py|sh|css|html)$/i.test(
      entry.name
    )
  )
    return <FileText size={20} className="text-emerald-400" />;
  return <File size={20} className="text-zinc-400 light:text-slate-500" />;
}

function WorkspaceFilesPanel({
  workspace,
  onClose = null,
  reserveUserControl = false,
}) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingPath, setDownloadingPath] = useState(null);

  const loadDirectory = useCallback(
    async (targetPath = "", { quiet = false } = {}) => {
      if (!workspace?.slug) return;
      if (!quiet) setLoading(true);
      setError(null);
      const result = await Workspace.listFiles(workspace.slug, targetPath);
      if (result.error) setError(result.error);
      else {
        setCurrentPath(result.path || "");
        setEntries(result.entries || []);
      }
      if (!quiet) setLoading(false);
    },
    [workspace?.slug]
  );

  const loadPreview = useCallback(
    async (entry, { quiet = false } = {}) => {
      if (!workspace?.slug) return;
      if (!quiet) setLoading(true);
      setError(null);
      const result = await Workspace.previewFile(workspace.slug, entry.path);
      if (result.error) setError(result.error);
      else setSelectedFile(result);
      if (!quiet) setLoading(false);
    },
    [workspace?.slug]
  );

  useEffect(() => {
    loadDirectory("");
  }, [loadDirectory]);

  useEffect(() => {
    function refreshAfterAgentRun() {
      if (selectedFile) loadPreview(selectedFile, { quiet: true });
      else loadDirectory(currentPath, { quiet: true });
    }
    window.addEventListener(AGENT_SESSION_END, refreshAfterAgentRun);
    return () =>
      window.removeEventListener(AGENT_SESSION_END, refreshAfterAgentRun);
  }, [currentPath, selectedFile, loadDirectory, loadPreview]);

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    return parts.map((name, index) => ({
      name,
      path: parts.slice(0, index + 1).join("/"),
    }));
  }, [currentPath]);

  async function openEntry(entry) {
    if (entry.type === "directory") {
      setSelectedFile(null);
      await loadDirectory(entry.path);
      return;
    }
    await loadPreview(entry);
  }

  async function downloadEntry(entry) {
    if (!entry || downloadingPath) return;
    setDownloadingPath(entry.path);
    try {
      const isDirectory = entry.type === "directory";
      const blob = isDirectory
        ? await Workspace.downloadFolder(workspace.slug, entry.path)
        : await Workspace.downloadFile(workspace.slug, entry.path);
      saveAs(blob, isDirectory ? `${entry.name}.zip` : entry.name);
    } catch {
      setError(
        t(
          entry.type === "directory"
            ? "chat_window.workspace_files.folder_download_error"
            : "chat_window.workspace_files.download_error"
        )
      );
    } finally {
      setDownloadingPath(null);
    }
  }

  function refresh() {
    if (selectedFile) loadPreview(selectedFile);
    else loadDirectory(currentPath);
  }

  return (
    <div className="h-full min-h-0 bg-zinc-900 light:bg-white light:border-2 light:border-slate-300 md:rounded-[16px] flex flex-col overflow-hidden text-white light:text-slate-900">
      <div
        className={`pl-4 ${reserveUserControl ? "pr-14" : "pr-4"} pt-4 pb-3 border-b border-zinc-700/70 light:border-slate-200 bg-zinc-900 light:bg-white`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[15px] leading-5">
              {t("chat_window.workspace_files.title")}
            </p>
            <p className="text-[11px] leading-4 text-zinc-400 light:text-slate-500 truncate">
              {t("chat_window.workspace_files.description")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              title={t("chat_window.workspace_files.refresh")}
              className="w-8 h-8 rounded-lg border-none bg-transparent hover:bg-zinc-800 light:hover:bg-slate-100 text-zinc-400 hover:text-white light:text-slate-500 light:hover:text-slate-900 flex items-center justify-center transition-colors disabled:opacity-40"
            >
              <ArrowsClockwise
                size={17}
                className={loading ? "animate-spin" : ""}
              />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title={t("chat_window.workspace_files.close")}
                className="w-8 h-8 rounded-lg border-none bg-transparent hover:bg-zinc-800 light:hover:bg-slate-100 text-zinc-400 hover:text-white light:text-slate-500 light:hover:text-slate-900 flex items-center justify-center transition-colors"
              >
                <X size={17} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>

      {selectedFile ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-3 py-2.5 flex items-center gap-2 border-b border-zinc-800 light:border-slate-200">
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="w-8 h-8 flex-shrink-0 rounded-lg border border-zinc-700 light:border-slate-300 bg-zinc-800 light:bg-slate-50 hover:bg-zinc-700 light:hover:bg-slate-100 flex items-center justify-center transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {selectedFile.name}
              </p>
              <p className="text-[11px] text-zinc-500 light:text-slate-500 truncate">
                {formatSize(selectedFile.size)} · {selectedFile.path}
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadEntry({ ...selectedFile, type: "file" })}
              disabled={Boolean(downloadingPath)}
              title={t("chat_window.workspace_files.download")}
              className="w-8 h-8 flex-shrink-0 rounded-lg border-none bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 light:text-emerald-700 flex items-center justify-center transition-colors disabled:opacity-40"
            >
              <DownloadSimple size={17} weight="bold" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-zinc-950/70 light:bg-slate-50">
            {error ? (
              <MessageState message={error} tone="error" />
            ) : selectedFile.kind === "image" ? (
              <div className="min-h-full p-4 flex items-center justify-center">
                <img
                  src={`data:${selectedFile.mime};base64,${selectedFile.content}`}
                  alt={selectedFile.name}
                  className="max-w-full max-h-full rounded-lg object-contain bg-[linear-gradient(45deg,#202020_25%,transparent_25%),linear-gradient(-45deg,#202020_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#202020_75%),linear-gradient(-45deg,transparent_75%,#202020_75%)] light:bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:16px_16px]"
                />
              </div>
            ) : selectedFile.kind === "text" ? (
              <>
                <pre className="m-0 p-4 text-[12px] leading-[1.65] font-mono text-zinc-200 light:text-slate-800 whitespace-pre-wrap break-words selection:bg-emerald-500/30">
                  {selectedFile.content || " "}
                </pre>
                {selectedFile.truncated && (
                  <p className="m-3 mt-0 px-3 py-2 rounded-md bg-amber-500/10 text-amber-300 light:text-amber-700 text-xs">
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
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-3 py-2.5 flex items-center gap-1 overflow-x-auto no-scroll border-b border-zinc-800 light:border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => loadDirectory("")}
              className="flex-shrink-0 w-7 h-7 rounded-md border-none bg-transparent hover:bg-zinc-800 light:hover:bg-slate-100 text-zinc-400 light:text-slate-500 flex items-center justify-center"
            >
              <House size={15} weight="fill" />
            </button>
            {breadcrumbs.map((crumb) => (
              <div key={crumb.path} className="flex items-center gap-1 min-w-0">
                <CaretRight
                  size={12}
                  className="flex-shrink-0 text-zinc-600 light:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => loadDirectory(crumb.path)}
                  className="max-w-[120px] truncate px-1.5 py-1 rounded border-none bg-transparent hover:bg-zinc-800 light:hover:bg-slate-100 text-zinc-300 light:text-slate-600"
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {error ? (
              <MessageState message={error} tone="error" />
            ) : loading ? (
              <div className="p-3 space-y-2">
                {[0, 1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-12 rounded-lg bg-zinc-800/80 light:bg-slate-100 animate-pulse"
                  />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <MessageState
                message={t("chat_window.workspace_files.empty")}
                detail={t("chat_window.workspace_files.empty_description")}
              />
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.path}
                  className="group flex w-full items-center rounded-lg bg-transparent pr-2 transition-colors hover:bg-zinc-800/80 light:hover:bg-slate-100"
                >
                  <button
                    type="button"
                    onClick={() => openEntry(entry)}
                    className="flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent px-3 py-2.5 text-left"
                  >
                    <span className="flex-shrink-0">{fileIcon(entry)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-200 light:text-slate-800">
                        {entry.name}
                      </span>
                      <span className="block truncate text-[10px] text-zinc-500 light:text-slate-500">
                        {entry.type === "directory"
                          ? t("chat_window.workspace_files.folder")
                          : formatSize(entry.size)}
                      </span>
                    </span>
                    {entry.type === "directory" && (
                      <CaretRight
                        size={14}
                        className="flex-shrink-0 text-zinc-600 group-hover:text-zinc-300 light:text-slate-400 light:group-hover:text-slate-700"
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadEntry(entry)}
                    disabled={Boolean(downloadingPath)}
                    title={t(
                      entry.type === "directory"
                        ? "chat_window.workspace_files.download_folder"
                        : "chat_window.workspace_files.download"
                    )}
                    aria-label={t(
                      entry.type === "directory"
                        ? "chat_window.workspace_files.download_folder"
                        : "chat_window.workspace_files.download"
                    )}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-none bg-transparent text-zinc-500 opacity-70 transition-colors hover:bg-emerald-500/15 hover:text-emerald-400 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-40 light:text-slate-500 light:hover:text-emerald-700"
                  >
                    {entry.type === "directory" ? (
                      <FileZip size={17} weight="bold" />
                    ) : (
                      <DownloadSimple size={17} weight="bold" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageState({ message, detail = null, tone = "normal" }) {
  return (
    <div className="h-full min-h-[180px] px-8 flex flex-col items-center justify-center text-center">
      <FileText
        size={28}
        className={
          tone === "error"
            ? "text-red-400"
            : "text-zinc-600 light:text-slate-400"
        }
      />
      <p
        className={`mt-3 text-sm ${tone === "error" ? "text-red-300 light:text-red-700" : "text-zinc-300 light:text-slate-700"}`}
      >
        {message}
      </p>
      {detail && (
        <p className="mt-1 text-xs leading-5 text-zinc-500 light:text-slate-500">
          {detail}
        </p>
      )}
    </div>
  );
}

function WorkspaceFilesSidebar({ workspace }) {
  const { sidebarOpen, closeSidebar } = useWorkspaceFilesSidebar();
  const [isPermanent, setIsPermanent] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event) => setIsPermanent(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  if (isPermanent)
    return (
      <aside className="h-full w-[280px] xl:w-[330px] 2xl:w-[380px] flex-shrink-0 rounded-[16px] shadow-[0_14px_45px_rgba(0,0,0,0.16)] light:shadow-[0_12px_35px_rgba(15,23,42,0.08)]">
        <WorkspaceFilesPanel workspace={workspace} reserveUserControl />
      </aside>
    );

  if (!sidebarOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-zinc-950/70 light:bg-slate-900/20 backdrop-blur-sm p-2 sm:p-3">
      <div className="h-full w-full max-w-[430px] ml-auto shadow-2xl rounded-[16px]">
        <WorkspaceFilesPanel workspace={workspace} onClose={closeSidebar} />
      </div>
    </div>
  );
}

export default memo(WorkspaceFilesSidebar);
