import {
  Copy,
  DownloadSimple,
  Eye,
  FileZip,
  FolderOpen,
  PencilSimple,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import ContextMenu from "@/components/lib/ContextMenu";
import type {
  ContextMenuState,
  TranslateFn,
  WorkspaceFileEntry,
} from "./types";

interface FileContextMenuProps {
  contextMenu: ContextMenuState;
  downloadingPath: string | null;
  onClose: () => void;
  onOpenDirectory: (entry: WorkspaceFileEntry) => void;
  onPreview: (entry: WorkspaceFileEntry) => void;
  onDownload: (entry: WorkspaceFileEntry) => void;
  onUploadHere: (entry: WorkspaceFileEntry) => void;
  onRename: (entry: WorkspaceFileEntry) => void;
  onCopyValue: (value: string, successKey: string) => void;
  onRequestDelete: (entry: WorkspaceFileEntry) => void;
  t: TranslateFn;
}

export function FileContextMenu({
  contextMenu,
  downloadingPath,
  onClose,
  onOpenDirectory,
  onPreview,
  onDownload,
  onUploadHere,
  onRename,
  onCopyValue,
  onRequestDelete,
  t,
}: FileContextMenuProps) {
  const { entry, point } = contextMenu;
  const isDirectory = entry.type === "directory";

  return (
    <ContextMenu
      point={point}
      label={t("chat_window.workspace_files.item_menu", {
        name: entry.name,
      })}
      onClose={onClose}
      width={196}
    >
      <button
        type="button"
        role="menuitem"
        className="dsh-menu-item"
        onClick={() => {
          if (isDirectory) onOpenDirectory(entry);
          else {
            onClose();
            onPreview(entry);
          }
        }}
      >
        {isDirectory ? <FolderOpen size={17} /> : <Eye size={17} />}
        <span>
          {t(
            isDirectory
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
          onClose();
          onDownload(entry);
        }}
      >
        {isDirectory ? <FileZip size={17} /> : <DownloadSimple size={17} />}
        <span>
          {t(
            isDirectory
              ? "chat_window.workspace_files.download_folder_action"
              : "chat_window.workspace_files.download_action"
          )}
        </span>
      </button>
      <div
        role="separator"
        className="mx-2 my-1 border-t border-theme-sidebar-border"
      />
      {isDirectory && (
        <button
          type="button"
          role="menuitem"
          className="dsh-menu-item"
          onClick={() => onUploadHere(entry)}
        >
          <UploadSimple size={17} />
          <span>{t("chat_window.workspace_files.upload_here")}</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="dsh-menu-item"
        onClick={() => onRename(entry)}
      >
        <PencilSimple size={17} />
        <span>{t("chat_window.workspace_files.rename")}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="dsh-menu-item"
        onClick={() =>
          onCopyValue(entry.name, "chat_window.workspace_files.name_copied")
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
          onCopyValue(entry.path, "chat_window.workspace_files.path_copied")
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
          onRequestDelete(entry);
          onClose();
        }}
      >
        <Trash size={17} />
        <span>{t("chat_window.workspace_files.delete")}</span>
      </button>
    </ContextMenu>
  );
}
