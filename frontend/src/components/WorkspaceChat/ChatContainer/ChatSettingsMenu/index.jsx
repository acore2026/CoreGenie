import { memo, useState, useRef, useEffect } from "react";
import { FolderOpen, SlidersHorizontal } from "@phosphor-icons/react";
import TextSizeRow from "./TextSize";
import MemoriesRow from "./Memories";
import ExportRow from "./Export";
import ShareChatButton from "../ShareChatButton";
import { useWorkspaceFilesSidebar } from "../ChatSidebar";
import { useTranslation } from "react-i18next";

function ChatSettingsMenu({
  hasHistory = false,
  workspace = null,
  threadSlug = null,
}) {
  const { t } = useTranslation();
  const { sidebarOpen: filesOpen, toggleSidebar: toggleFiles } =
    useWorkspaceFilesSidebar();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClickOutside(e) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  return (
    <div className="absolute right-4 top-3 z-40 flex items-center gap-1 md:right-6 md:top-4">
      <button
        type="button"
        onClick={toggleFiles}
        title={t("chat_window.workspace_files.open")}
        aria-label={t("chat_window.workspace_files.open")}
        className={`group flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-transparent text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary lg:hidden ${
          filesOpen
            ? "bg-theme-sidebar-subitem-selected text-theme-text-primary"
            : ""
        }`}
      >
        <FolderOpen size={19} weight={filesOpen ? "fill" : "regular"} />
      </button>
      <ShareChatButton workspace={workspace} threadSlug={threadSlug} />
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setShowMenu(!showMenu)}
          aria-label={t("keyboard-shortcuts.shortcuts.chatSettings")}
          className={`group flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-transparent text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${
            showMenu
              ? "bg-theme-sidebar-subitem-selected text-theme-text-primary"
              : ""
          }`}
        >
          <SlidersHorizontal size={18} className="text-current" />
        </button>

        {showMenu && (
          <div
            ref={menuRef}
            className="dsh-menu absolute right-0 top-10 flex w-[226px] flex-col gap-1"
          >
            <TextSizeRow />
            <MemoriesRow onClose={() => setShowMenu(false)} />
            <ExportRow
              hasHistory={hasHistory}
              workspace={workspace}
              threadSlug={threadSlug}
              onClose={() => setShowMenu(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ChatSettingsMenu);
