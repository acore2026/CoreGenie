import {
  CaretRight,
  CircleNotch,
  DownloadSimple,
  File,
  FileText,
  FileZip,
  Folder,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import { userFacingErrorKey } from "@/utils/userFacingError.mjs";
import {
  formatSize,
  type FileLevelState,
  type TranslateFn,
  type WorkspaceFileEntry,
} from "./types";

function fileIcon(entry: WorkspaceFileEntry) {
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

interface FileTreeLevelProps {
  path: string;
  depth: number;
  levels: Record<string, FileLevelState>;
  expandedPaths: Set<string>;
  activeDirectory: string;
  onToggle: (
    entry: { path: string; type: "directory" },
    retry?: boolean
  ) => void;
  onOpen: (entry: WorkspaceFileEntry) => void;
  onDownload: (entry: WorkspaceFileEntry) => void;
  onContextMenu: (
    entry: WorkspaceFileEntry,
    point: { x: number; y: number }
  ) => void;
  renamingPath?: string;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: (entry: WorkspaceFileEntry) => void;
  onRenameCancel: () => void;
  mutatingPath: string | null;
  downloadingPath: string | null;
  t: TranslateFn;
}

export function FileTreeLevel({
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
}: FileTreeLevelProps) {
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
        {t(userFacingErrorKey(level.error))}
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

  return (
    <>
      {level.entries.map((entry) => {
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
                    onClick={() =>
                      isDirectory
                        ? onToggle({ path: entry.path, type: "directory" })
                        : onOpen(entry)
                    }
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
                    <span className="min-w-0 flex-1 truncate">
                      {entry.name}
                    </span>
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
      })}
    </>
  );
}
