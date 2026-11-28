import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowsClockwise,
  CircleNotch,
  FolderOpen,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useDropzone } from "react-dropzone";
import { saveAs } from "file-saver";
import { Dialog } from "@headlessui/react";
import { userFacingErrorKey } from "@/utils/userFacingError.mjs";
import Workspace from "@/models/workspace";
import { WORKSPACE_FILES_CHANGED } from "@/utils/workspaceUpload";
import { AGENT_SESSION_END } from "@/utils/chat/agent";
import { useWorkspaceFilesSidebar } from "../ChatSidebar";
import TaskPlanPanel from "../TaskPlanPanel";
import ConfirmDialog from "@/components/lib/ConfirmDialog";
import { copyTextToClipboard } from "@/utils/clipboard";
import showToast from "@/utils/toast";
import { FileTreeLevel } from "./FileTreeLevel";
import { FilePreviewPane } from "./FilePreviewPane";
import { FileContextMenu } from "./FileContextMenu";
import {
  includesPath,
  parentDirectory,
  type ContextMenuState,
  type FileLevelState,
  type FilePreviewData,
  type WorkspaceFileEntry,
} from "./types";

interface WorkspaceSummary {
  slug: string;
  name?: string;
}

interface WorkspaceFilesPanelProps {
  workspace?: WorkspaceSummary | null;
  onClose?: (() => void) | null;
}

export function WorkspaceFilesPanel({
  workspace,
  onClose = null,
}: WorkspaceFilesPanelProps) {
  const { t } = useTranslation();
  const [levels, setLevels] = useState<Record<string, FileLevelState>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [activeDirectory, setActiveDirectory] = useState("");
  const [selectedFile, setSelectedFile] = useState<FilePreviewData | null>(
    null
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<WorkspaceFileEntry | null>(
    null
  );
  const [renameValue, setRenameValue] = useState("");
  const [deleteEntry, setDeleteEntry] = useState<WorkspaceFileEntry | null>(
    null
  );
  const [mutatingPath, setMutatingPath] = useState<string | null>(null);
  const generations = useRef<Map<string, number>>(new Map());
  const requests = useRef<Map<string, AbortController>>(new Map());
  const mutationLock = useRef(false);
  const uploadTarget = useRef<string | null>(null);

  const loadLevel = useCallback(
    async (targetPath = "", { quiet = false }: { quiet?: boolean } = {}) => {
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
      const result = (await Workspace.listFiles(workspace.slug, targetPath, {
        signal: controller.signal,
      })) as unknown as {
        aborted?: boolean;
        error?: string | null;
        entries?: WorkspaceFileEntry[];
      };
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
    async (
      entry: { path: string },
      { quiet = false }: { quiet?: boolean } = {}
    ) => {
      if (!workspace?.slug) return;
      if (!quiet) setPreviewLoading(true);
      setError(null);
      const result = (await Workspace.previewFile(
        workspace.slug,
        entry.path
      )) as unknown as FilePreviewData;
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
    void loadLevel("");
    return () => {
      requests.current.forEach((request) => request.abort());
    };
  }, [loadLevel]);

  useEffect(() => {
    function refreshAfterAgentRun() {
      if (selectedFile) void loadPreview(selectedFile, { quiet: true });
      new Set(["", ...expandedPaths]).forEach(
        (dirPath) => void loadLevel(dirPath, { quiet: true })
      );
    }
    window.addEventListener(AGENT_SESSION_END, refreshAfterAgentRun);
    const refreshUploads = (event: Event) => {
      const detail = (event as CustomEvent<{ slug?: string }>).detail;
      if (detail?.slug === workspace?.slug) refreshAfterAgentRun();
    };
    window.addEventListener(WORKSPACE_FILES_CHANGED, refreshUploads);
    return () => {
      window.removeEventListener(AGENT_SESSION_END, refreshAfterAgentRun);
      window.removeEventListener(WORKSPACE_FILES_CHANGED, refreshUploads);
    };
  }, [expandedPaths, selectedFile, loadLevel, loadPreview, workspace?.slug]);

  function toggleDirectory(
    entry: { path: string; type: "directory" },
    retry = false
  ) {
    const targetPath = entry.path || "";
    setActiveDirectory(targetPath);
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (retry || !next.has(targetPath)) next.add(targetPath);
      else next.delete(targetPath);
      return next;
    });
    if (retry || !levels[targetPath]) void loadLevel(targetPath);
  }

  function openDirectory(entry: WorkspaceFileEntry) {
    const targetPath = entry.path || "";
    setContextMenu(null);
    setActiveDirectory(targetPath);
    setExpandedPaths((current) => new Set([...current, targetPath]));
    if (!levels[targetPath]) void loadLevel(targetPath);
  }

  async function downloadEntry(entry: WorkspaceFileEntry) {
    if (!entry || downloadingPath || !workspace?.slug) return;
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

  function removeCachedBranch(targetPath: string) {
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

  function startRename(entry: WorkspaceFileEntry) {
    setContextMenu(null);
    setRenamingEntry(entry);
    setRenameValue(entry.name);
  }

  async function renameEntry(entry: WorkspaceFileEntry) {
    if (mutationLock.current || !entry || !workspace?.slug) return;
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
    ).catch((renameError: Error) => ({
      response: { ok: false },
      data: { error: renameError.message },
    }));
    mutationLock.current = false;
    setMutatingPath(null);
    if (!response.ok) {
      showToast(
        (data as { error?: string } | null)?.error ||
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

  async function copyEntryValue(value: string, successMessage: string) {
    setContextMenu(null);
    const copied = await copyTextToClipboard(value);
    showToast(
      t(copied ? successMessage : "chat_window.workspace_files.copy_failed"),
      copied ? "success" : "error",
      { clear: true }
    );
  }

  async function confirmDeleteEntry() {
    if (mutationLock.current || !deleteEntry || !workspace?.slug) return;
    const entry = deleteEntry;
    mutationLock.current = true;
    setMutatingPath(entry.path);
    const { response, data } = await Workspace.deleteWorkspaceEntry(
      workspace.slug,
      entry.path
    ).catch((deleteError: Error) => ({
      response: { ok: false },
      data: { error: deleteError.message },
    }));
    mutationLock.current = false;
    setMutatingPath(null);
    if (!response.ok) {
      showToast(
        (data as { error?: string } | null)?.error ||
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
      void loadPreview(selectedFile);
      return;
    }
    new Set(["", ...expandedPaths]).forEach(
      (dirPath) => void loadLevel(dirPath, { quiet: true })
    );
  }

  const uploadFiles = useCallback(
    async (selectedFiles: File[] = []) => {
      if (!selectedFiles.length || uploadingCount > 0 || !workspace?.slug)
        return;
      const targetPath = uploadTarget.current ?? activeDirectory;
      uploadTarget.current = null;
      setUploadingCount(selectedFiles.length);
      setUploadMessage(null);
      setError(null);
      const failures: string[] = [];
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("file", file, file.name);
        formData.append("path", targetPath || ".");
        try {
          const { response, data } = await Workspace.uploadWorkspaceFile(
            workspace.slug,
            formData
          );
          if (!response.ok)
            failures.push(
              (data as { error?: string } | null)?.error || file.name
            );
        } catch (uploadError: unknown) {
          failures.push((uploadError as Error).message || file.name);
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
          {error ? t(userFacingErrorKey(error)) : uploadMessage}
        </div>
      )}

      {selectedFile ? (
        <FilePreviewPane
          selectedFile={selectedFile}
          previewLoading={previewLoading}
          error={error}
          downloadingPath={downloadingPath}
          onBack={() => {
            setSelectedFile(null);
            setError(null);
          }}
          onDownload={downloadEntry}
          t={t}
        />
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
        <FileContextMenu
          contextMenu={contextMenu}
          downloadingPath={downloadingPath}
          onClose={() => setContextMenu(null)}
          onOpenDirectory={openDirectory}
          onPreview={loadPreview}
          onDownload={downloadEntry}
          onUploadHere={(entry) => {
            uploadTarget.current = entry.path;
            setActiveDirectory(entry.path);
            setContextMenu(null);
            openUploadPicker();
          }}
          onRename={startRename}
          onCopyValue={copyEntryValue}
          onRequestDelete={(entry) => setDeleteEntry(entry)}
          t={t}
        />
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

interface WorkspaceFilesSidebarProps {
  workspace?: WorkspaceSummary | null;
  history?: unknown[];
  showFiles?: boolean;
}

function WorkspaceFilesSidebar({
  workspace,
  history = [],
  showFiles = true,
}: WorkspaceFilesSidebarProps) {
  const { sidebarOpen, closeSidebar } = useWorkspaceFilesSidebar();
  const [isPermanent, setIsPermanent] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event: MediaQueryListEvent) =>
      setIsPermanent(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  if (isPermanent)
    return (
      <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-theme-sidebar-border xl:w-[330px] 2xl:w-[380px]">
        <TaskPlanPanel history={history as never[]} onClose={undefined} />
        {showFiles && (
          <div className="min-h-0 flex-1">
            <WorkspaceFilesPanel workspace={workspace} />
          </div>
        )}
      </aside>
    );

  if (!sidebarOpen) return null;
  return (
    <Dialog
      open={sidebarOpen}
      onClose={closeSidebar}
      className="fixed inset-0 z-[60]"
    >
      <div
        className="absolute inset-0 bg-zinc-950/60 light:bg-slate-900/20"
        aria-hidden="true"
      />
      <Dialog.Panel className="relative ml-auto flex h-full w-full max-w-[430px] flex-col border-l border-theme-sidebar-border bg-theme-bg-chat">
        <Dialog.Title className="sr-only">
          <PanelTitle />
        </Dialog.Title>
        <TaskPlanPanel history={history as never[]} onClose={closeSidebar} />
        {showFiles && (
          <div className="min-h-0 flex-1">
            <WorkspaceFilesPanel workspace={workspace} />
          </div>
        )}
      </Dialog.Panel>
    </Dialog>
  );
}

function PanelTitle() {
  const { t } = useTranslation();
  return t("task_plan.open_panel");
}

export default memo(WorkspaceFilesSidebar);
