import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowsClockwise,
  CaretRight,
  CircleNotch,
  DownloadSimple,
  Eye,
  File,
  FileText,
  Folder,
  FolderOpen,
  FileZip,
  Image as ImageIcon,
  Copy,
  PencilSimple,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useDropzone } from "react-dropzone";
import { saveAs } from "file-saver";
import Workspace from "@/models/workspace";
import { AGENT_SESSION_END } from "@/utils/chat/agent";
import { useWorkspaceFilesSidebar } from "../ChatSidebar";
import ContextMenu from "@/components/lib/ContextMenu";
import ConfirmDialog from "@/components/lib/ConfirmDialog";
import { copyTextToClipboard } from "@/utils/clipboard";
import showToast from "@/utils/toast";

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

function parentDirectory(entryPath = "") {
  const segments = String(entryPath).split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function includesPath(parent, child) {
  if (!parent || !child) return false;
  return child === parent || child.startsWith(`${parent}/`);
}

function fileIcon(entry) {
  if (entry.type === "directory")
    return (
      <Folder size={16} weight="fill" className="text-theme-text-secondary" />
    );
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(entry.name))
    return <ImageIcon size={16} className="text-theme-text-secondary" />;
  if (
    /\.(md|txt|json|ya?ml|toml|csv|log|jsx?|tsx?|py|sh|css|html)$/i.test(
      entry.name
    )
  )
    return <FileText size={16} className="text-theme-text-secondary" />;
  return <File size={16} className="text-theme-text-secondary" />;
}

function FileTreeLevel({
  path,
  depth,
  levels,
  expandedPaths,
  activeDirectory,
  onToggle,
  onOpen,
  onDownload,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  mutatingPath,
  downloadingPath,
  t,
}) {
  const level = levels[path];

  if (!level || (level.loading && !level.entries)) {
    return (
      <div
        role="status"
        className="flex h-8 items-center gap-2 text-xs text-theme-text-secondary"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <CircleNotch size={13} className="animate-spin" />
        {t("workspace_list.loading")}
      </div>
    );
  }

  if (level.error) {
    return (
      <button
        type="button"
        onClick={() => onToggle({ path, type: "directory" }, true)}
        className="flex min-h-8 w-full items-center text-left text-xs text-red-300 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary light:text-red-700"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        {level.error}
      </button>
    );
  }

  if (!level.entries?.length) {
    return (
      <div
        className="flex h-8 items-center text-xs text-theme-text-secondary"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        {depth === 0
          ? t("chat_window.workspace_files.empty")
          : t("chat_window.workspace_files.empty_folder")}
      </div>
    );
  }

  return level.entries.map((entry) => {
    const isDirectory = entry.type === "directory";
    const expanded = isDirectory && expandedPaths.has(entry.path);
    const active = isDirectory && activeDirectory === entry.path;
    const renaming = renamingPath === entry.path;
    return (
      <div key={entry.path}>
        <div
          className={`group/file relative flex min-h-9 items-center rounded-md ${
            active
              ? "bg-theme-sidebar-subitem-selected"
              : "hover:bg-theme-sidebar-subitem-hover focus-within:bg-theme-sidebar-subitem-hover"
          }`}
          onContextMenu={(event) => {
            event.preventDefault();
            onContextMenu(entry, { x: event.clientX, y: event.clientY });
          }}
        >
          {renaming ? (
            <form
              className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 pr-2"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onSubmit={(event) => {
                event.preventDefault();
                onRenameSubmit(entry);
              }}
            >
              {isDirectory ? (
                <CaretRight
                  size={12}
                  weight="bold"
                  className={`shrink-0 text-theme-text-secondary ${expanded ? "rotate-90" : ""}`}
                />
              ) : (
                <span className="w-3 shrink-0" aria-hidden="true" />
              )}
              <span className="shrink-0">{fileIcon(entry)}</span>
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => onRenameChange(event.target.value)}
                onBlur={() => onRenameSubmit(entry)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  onRenameCancel();
                }}
                disabled={mutatingPath === entry.path}
                aria-label={t("chat_window.workspace_files.rename_label", {
                  name: entry.name,
                })}
                className="dsh-control h-7 min-w-0 flex-1 px-2 text-[15px]"
              />
              {mutatingPath === entry.path && (
                <CircleNotch
                  size={14}
                  className="shrink-0 animate-spin text-theme-text-secondary"
                />
              )}
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => (isDirectory ? onToggle(entry) : onOpen(entry))}
                aria-expanded={isDirectory ? expanded : undefined}
                className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 pr-9 text-left text-[15px] text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary"
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                title={entry.name}
              >
                {isDirectory ? (
                  <CaretRight
                    size={12}
                    weight="bold"
                    className={`shrink-0 text-theme-text-secondary transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
                  />
                ) : (
                  <span className="w-3 shrink-0" aria-hidden="true" />
                )}
                <span className="shrink-0">{fileIcon(entry)}</span>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {!isDirectory && (
                  <span className="shrink-0 text-[10px] tabular-nums text-theme-text-secondary opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100">
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onDownload(entry)}
                disabled={Boolean(downloadingPath || mutatingPath)}
                title={t(
                  isDirectory
                    ? "chat_window.workspace_files.download_folder"
                    : "chat_window.workspace_files.download"
                )}
                aria-label={t(
                  isDirectory
                    ? "chat_window.workspace_files.download_folder"
                    : "chat_window.workspace_files.download"
                )}
                className="absolute right-0 flex h-9 w-8 items-center justify-center rounded-md text-theme-text-secondary opacity-0 transition-opacity hover:text-theme-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary group-hover/file:opacity-100 disabled:cursor-wait disabled:opacity-40"
              >
                {isDirectory ? (
                  <FileZip size={15} />
                ) : (
                  <DownloadSimple size={15} />
                )}
              </button>
            </>
          )}
        </div>
        {expanded && (
          <FileTreeLevel
            path={entry.path}
            depth={depth + 1}
            levels={levels}
            expandedPaths={expandedPaths}
            activeDirectory={activeDirectory}
            onToggle={onToggle}
            onOpen={onOpen}
            onDownload={onDownload}
            onContextMenu={onContextMenu}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={onRenameChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            mutatingPath={mutatingPath}
            downloadingPath={downloadingPath}
            t={t}
          />
        )}
      </div>
    );
  });
}

export function WorkspaceFilesPanel({ workspace, onClose = null }) {
  const { t } = useTranslation();
  const [levels, setLevels] = useState({});
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [activeDirectory, setActiveDirectory] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloadingPath, setDownloadingPath] = useState(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadMessage, setUploadMessage] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [renamingEntry, setRenamingEntry] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [mutatingPath, setMutatingPath] = useState(null);
  const generations = useRef(new Map());
  const requests = useRef(new Map());
  const mutationLock = useRef(false);
  const uploadTarget = useRef(null);

  const loadLevel = useCallback(
    async (targetPath = "", { quiet = false } = {}) => {
      if (!workspace?.slug) return;
      requests.current.get(targetPath)?.abort();
      const controller = new AbortController();
      requests.current.set(targetPath, controller);
      const generation = (generations.current.get(targetPath) || 0) + 1;
      generations.current.set(targetPath, generation);
      setLevels((current) => ({
        ...current,
        [targetPath]: {
          ...current[targetPath],
          loading: true,
          error: null,
          entries: quiet ? current[targetPath]?.entries : undefined,
        },
      }));
      const result = await Workspace.listFiles(workspace.slug, targetPath, {
        signal: controller.signal,
      });
      if (result.aborted || generations.current.get(targetPath) !== generation)
        return;
      setLevels((current) => ({
        ...current,
        [targetPath]: result.error
          ? { loading: false, error: result.error, entries: null }
          : { loading: false, error: null, entries: result.entries || [] },
      }));
    },
    [workspace?.slug]
  );

  const loadPreview = useCallback(
    async (entry, { quiet = false } = {}) => {
      if (!workspace?.slug) return;
      if (!quiet) setPreviewLoading(true);
      setError(null);
      const result = await Workspace.previewFile(workspace.slug, entry.path);
      if (result.error) setError(result.error);
      else setSelectedFile(result);
      if (!quiet) setPreviewLoading(false);
    },
    [workspace?.slug]
  );

  useEffect(() => {
    requests.current.forEach((request) => request.abort());
    requests.current.clear();
    generations.current.clear();
    setLevels({});
    setExpandedPaths(new Set());
    setActiveDirectory("");
    setSelectedFile(null);
    setError(null);
    setContextMenu(null);
    setRenamingEntry(null);
    setDeleteEntry(null);
    loadLevel("");
    return () => {
      requests.current.forEach((request) => request.abort());
    };
  }, [loadLevel]);

  useEffect(() => {
    function refreshAfterAgentRun() {
      if (selectedFile) loadPreview(selectedFile, { quiet: true });
      new Set(["", ...expandedPaths]).forEach((path) =>
        loadLevel(path, { quiet: true })
      );
    }
    window.addEventListener(AGENT_SESSION_END, refreshAfterAgentRun);
    return () =>
      window.removeEventListener(AGENT_SESSION_END, refreshAfterAgentRun);
  }, [expandedPaths, selectedFile, loadLevel, loadPreview]);

  function toggleDirectory(entry, retry = false) {
    const targetPath = entry.path || "";
    setActiveDirectory(targetPath);
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (retry || !next.has(targetPath)) next.add(targetPath);
      else next.delete(targetPath);
      return next;
    });
    if (retry || !levels[targetPath]) loadLevel(targetPath);
  }

  function openDirectory(entry) {
    const targetPath = entry.path || "";
    setContextMenu(null);
    setActiveDirectory(targetPath);
    setExpandedPaths((current) => new Set([...current, targetPath]));
    if (!levels[targetPath]) loadLevel(targetPath);
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

  function removeCachedBranch(targetPath) {
    setLevels((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([cachedPath]) => !includesPath(targetPath, cachedPath)
        )
      )
    );
    setExpandedPaths(
      (current) =>
        new Set([...current].filter((item) => !includesPath(targetPath, item)))
    );
  }

  function startRename(entry) {
    setContextMenu(null);
    setRenamingEntry(entry);
    setRenameValue(entry.name);
  }

  async function renameEntry(entry) {
    if (mutationLock.current || !entry) return;
    const name = renameValue.trim();
    if (!name || name === entry.name) {
      setRenamingEntry(null);
      setRenameValue("");
      return;
    }

    mutationLock.current = true;
    setMutatingPath(entry.path);
    const { response, data } = await Workspace.renameWorkspaceEntry(
      workspace.slug,
      entry.path,
      name
    ).catch((renameError) => ({
      response: { ok: false },
      data: { error: renameError.message },
    }));
    mutationLock.current = false;
    setMutatingPath(null);
    if (!response.ok) {
      showToast(
        data?.error ||
          t("chat_window.workspace_files.rename_failed", {
            name: entry.name,
          }),
        "error",
        { clear: true }
      );
      return;
    }

    const parent = parentDirectory(entry.path);
    removeCachedBranch(entry.path);
    setActiveDirectory((current) =>
      includesPath(entry.path, current) ? parent : current
    );
    setSelectedFile((current) =>
      includesPath(entry.path, current?.path) ? null : current
    );
    setRenamingEntry(null);
    setRenameValue("");
    await loadLevel(parent, { quiet: true });
  }

  async function copyEntryValue(value, successMessage) {
    setContextMenu(null);
    const copied = await copyTextToClipboard(value);
    showToast(
      t(copied ? successMessage : "chat_window.workspace_files.copy_failed"),
      copied ? "success" : "error",
      { clear: true }
    );
  }

  async function confirmDeleteEntry() {
    if (mutationLock.current || !deleteEntry) return;
    const entry = deleteEntry;
    mutationLock.current = true;
    setMutatingPath(entry.path);
    const { response, data } = await Workspace.deleteWorkspaceEntry(
      workspace.slug,
      entry.path
    ).catch((deleteError) => ({
      response: { ok: false },
      data: { error: deleteError.message },
    }));
    mutationLock.current = false;
    setMutatingPath(null);
    if (!response.ok) {
      showToast(
        data?.error ||
          t("chat_window.workspace_files.delete_failed", {
            name: entry.name,
          }),
        "error",
        { clear: true }
      );
      return;
    }

    const parent = parentDirectory(entry.path);
    removeCachedBranch(entry.path);
    setActiveDirectory((current) =>
      includesPath(entry.path, current) ? parent : current
    );
    setSelectedFile((current) =>
      includesPath(entry.path, current?.path) ? null : current
    );
    setDeleteEntry(null);
    await loadLevel(parent, { quiet: true });
  }

  function refresh() {
    if (selectedFile) {
      loadPreview(selectedFile);
      return;
    }
    new Set(["", ...expandedPaths]).forEach((path) =>
      loadLevel(path, { quiet: true })
    );
  }

  const uploadFiles = useCallback(
    async (selectedFiles = []) => {
      if (!selectedFiles.length || uploadingCount > 0 || !workspace?.slug)
        return;
      const targetPath = uploadTarget.current ?? activeDirectory;
      uploadTarget.current = null;
      setUploadingCount(selectedFiles.length);
      setUploadMessage(null);
      setError(null);
      const failures = [];
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("file", file, file.name);
        formData.append("path", targetPath || ".");
        try {
          const { response, data } = await Workspace.uploadWorkspaceFile(
            workspace.slug,
            formData
          );
          if (!response.ok) failures.push(data?.error || file.name);
        } catch (uploadError) {
          failures.push(uploadError.message || file.name);
        }
      }
      setUploadingCount(0);
      if (failures.length) setError(failures.join(" "));
      else
        setUploadMessage(
          t("chat_window.workspace_files.upload_complete", {
            count: selectedFiles.length,
          })
        );
      await loadLevel(targetPath, { quiet: true });
    },
    [activeDirectory, loadLevel, t, uploadingCount, workspace?.slug]
  );

  const {
    getRootProps,
    getInputProps,
    open: openUploadPicker,
    isDragActive,
  } = useDropzone({
    onDropAccepted: uploadFiles,
    onFileDialogCancel: () => {
      uploadTarget.current = null;
    },
    noClick: true,
    noKeyboard: true,
    noDragEventsBubbling: true,
    disabled: uploadingCount > 0,
  });

  const treeLoading = Boolean(levels[""]?.loading);

  return (
    <div
      {...getRootProps()}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-theme-bg-chat text-theme-text-primary"
    >
      <input {...getInputProps()} />
      {isDragActive && (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-md border border-theme-button-primary bg-theme-bg-primary/95">
          <div className="flex flex-col items-center gap-2 text-center">
            <UploadSimple
              size={24}
              className="text-cyan-300 light:text-cyan-700"
            />
            <p className="text-sm font-medium">
              {t("chat_window.workspace_files.drop_title")}
            </p>
            <p className="max-w-[260px] text-xs text-theme-text-secondary">
              {t("chat_window.workspace_files.drop_description", {
                path: activeDirectory || "/",
              })}
            </p>
          </div>
        </div>
      )}

      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-theme-sidebar-border pl-4 pr-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {t("chat_window.workspace_files.title")}
          </p>
          <p className="truncate text-[11px] text-theme-text-secondary">
            {activeDirectory || workspace?.name || "/"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            uploadTarget.current = activeDirectory;
            openUploadPicker();
          }}
          disabled={uploadingCount > 0}
          title={t("chat_window.workspace_files.upload")}
          aria-label={t("chat_window.workspace_files.upload")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary disabled:cursor-wait disabled:opacity-40"
        >
          {uploadingCount ? (
            <CircleNotch size={16} className="animate-spin" />
          ) : (
            <UploadSimple size={16} />
          )}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={treeLoading || previewLoading}
          title={t("chat_window.workspace_files.refresh")}
          aria-label={t("chat_window.workspace_files.refresh")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary disabled:opacity-40"
        >
          <ArrowsClockwise
            size={16}
            className={treeLoading || previewLoading ? "animate-spin" : ""}
          />
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title={t("chat_window.workspace_files.close")}
            aria-label={t("chat_window.workspace_files.close")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {(uploadMessage || (error && !selectedFile)) && (
        <div
          aria-live="polite"
          className={`border-b border-theme-sidebar-border px-4 py-2 text-xs ${error ? "text-red-300 light:text-red-700" : "text-theme-text-secondary"}`}
        >
          {error || uploadMessage}
        </div>
      )}

      {selectedFile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-11 items-center gap-2 border-b border-theme-sidebar-border px-2">
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setError(null);
              }}
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
              onClick={() => downloadEntry({ ...selectedFile, type: "file" })}
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
              <MessageState message={error} tone="error" />
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
      ) : (
        <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
          <div className="mb-1 flex h-9 items-center gap-1.5 px-2 text-[15px] font-medium text-theme-text-secondary">
            <FolderOpen size={16} />
            <span className="min-w-0 flex-1 truncate">
              {workspace?.name || t("chat_window.workspace_files.title")}
            </span>
            {treeLoading && <CircleNotch size={13} className="animate-spin" />}
          </div>
          <FileTreeLevel
            path=""
            depth={0}
            levels={levels}
            expandedPaths={expandedPaths}
            activeDirectory={activeDirectory}
            onToggle={toggleDirectory}
            onOpen={loadPreview}
            onDownload={downloadEntry}
            onContextMenu={(entry, point) => setContextMenu({ entry, point })}
            renamingPath={renamingEntry?.path}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameSubmit={renameEntry}
            onRenameCancel={() => {
              setRenamingEntry(null);
              setRenameValue("");
            }}
            mutatingPath={mutatingPath}
            downloadingPath={downloadingPath}
            t={t}
          />
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          point={contextMenu.point}
          label={t("chat_window.workspace_files.item_menu", {
            name: contextMenu.entry.name,
          })}
          onClose={() => setContextMenu(null)}
          width={196}
        >
          <button
            type="button"
            role="menuitem"
            className="dsh-menu-item"
            onClick={() => {
              const entry = contextMenu.entry;
              if (entry.type === "directory") openDirectory(entry);
              else {
                setContextMenu(null);
                loadPreview(entry);
              }
            }}
          >
            {contextMenu.entry.type === "directory" ? (
              <FolderOpen size={17} />
            ) : (
              <Eye size={17} />
            )}
            <span>
              {t(
                contextMenu.entry.type === "directory"
                  ? "chat_window.workspace_files.open_folder"
                  : "chat_window.workspace_files.preview"
              )}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="dsh-menu-item"
            disabled={Boolean(downloadingPath)}
            onClick={() => {
              const entry = contextMenu.entry;
              setContextMenu(null);
              downloadEntry(entry);
            }}
          >
            {contextMenu.entry.type === "directory" ? (
              <FileZip size={17} />
            ) : (
              <DownloadSimple size={17} />
            )}
            <span>
              {t(
                contextMenu.entry.type === "directory"
                  ? "chat_window.workspace_files.download_folder_action"
                  : "chat_window.workspace_files.download_action"
              )}
            </span>
          </button>
          <div
            role="separator"
            className="mx-2 my-1 border-t border-theme-sidebar-border"
          />
          {contextMenu.entry.type === "directory" && (
            <button
              type="button"
              role="menuitem"
              className="dsh-menu-item"
              onClick={() => {
                uploadTarget.current = contextMenu.entry.path;
                setActiveDirectory(contextMenu.entry.path);
                setContextMenu(null);
                openUploadPicker();
              }}
            >
              <UploadSimple size={17} />
              <span>{t("chat_window.workspace_files.upload_here")}</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="dsh-menu-item"
            onClick={() => startRename(contextMenu.entry)}
          >
            <PencilSimple size={17} />
            <span>{t("chat_window.workspace_files.rename")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="dsh-menu-item"
            onClick={() =>
              copyEntryValue(
                contextMenu.entry.name,
                "chat_window.workspace_files.name_copied"
              )
            }
          >
            <Copy size={17} />
            <span>{t("chat_window.workspace_files.copy_name")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="dsh-menu-item"
            onClick={() =>
              copyEntryValue(
                contextMenu.entry.path,
                "chat_window.workspace_files.path_copied"
              )
            }
          >
            <Copy size={17} />
            <span>{t("chat_window.workspace_files.copy_path")}</span>
          </button>
          <div
            role="separator"
            className="mx-2 my-1 border-t border-theme-sidebar-border"
          />
          <button
            type="button"
            role="menuitem"
            className="dsh-menu-item dsh-menu-item-danger"
            onClick={() => {
              setDeleteEntry(contextMenu.entry);
              setContextMenu(null);
            }}
          >
            <Trash size={17} />
            <span>{t("chat_window.workspace_files.delete")}</span>
          </button>
        </ContextMenu>
      )}
      <ConfirmDialog
        open={Boolean(deleteEntry)}
        title={t("chat_window.workspace_files.delete_title", {
          type: t(
            deleteEntry?.type === "directory"
              ? "chat_window.workspace_files.folder"
              : "chat_window.workspace_files.file"
          ),
        })}
        description={t(
          deleteEntry?.type === "directory"
            ? "chat_window.workspace_files.delete_folder_description"
            : "chat_window.workspace_files.delete_file_description",
          { name: deleteEntry?.name }
        )}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("chat_window.workspace_files.delete")}
        busy={Boolean(mutatingPath)}
        onCancel={() => setDeleteEntry(null)}
        onConfirm={confirmDeleteEntry}
      />
    </div>
  );
}

function MessageState({ message, tone = "normal", loading = false }) {
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
      <aside className="h-full w-[280px] shrink-0 border-l border-theme-sidebar-border xl:w-[330px] 2xl:w-[380px]">
        <WorkspaceFilesPanel workspace={workspace} />
      </aside>
    );

  if (!sidebarOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-zinc-950/60 light:bg-slate-900/20">
      <div className="ml-auto h-full w-full max-w-[430px] border-l border-theme-sidebar-border bg-theme-bg-chat">
        <WorkspaceFilesPanel workspace={workspace} onClose={closeSidebar} />
      </div>
    </div>
  );
}

export default memo(WorkspaceFilesSidebar);
