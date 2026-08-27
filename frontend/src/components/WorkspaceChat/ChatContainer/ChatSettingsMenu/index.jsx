import { memo, useState, useRef, useEffect } from "react";
import { FolderOpen, SlidersHorizontal } from "@phosphor-icons/react";
import TextSizeRow from "./TextSize";
import MemoriesRow from "./Memories";
import ExportRow from "./Export";
import SettingsButton from "@/components/SettingsButton";
import ShareChatButton from "../ShareChatButton";
import { useWorkspaceFilesSidebar } from "../ChatSidebar";
import { useTranslation } from "react-i18next";
import UserButton from "@/components/UserMenu/UserButton";

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
    <div className="absolute right-4 top-3 z-40 flex items-center gap-2 md:right-6 md:top-5">
      <button
        type="button"
        onClick={toggleFiles}
        title={t("chat_window.workspace_files.open")}
        aria-label={t("chat_window.workspace_files.open")}
        className={`lg:hidden group border-none cursor-pointer flex items-center justify-center w-[35px] h-[35px] rounded-full transition-all ${
          filesOpen
            ? "bg-emerald-500/20 text-emerald-400 light:text-emerald-700"
            : "text-zinc-300 light:text-slate-600 hover:bg-zinc-700 light:hover:bg-slate-200"
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
          className={`group border-none cursor-pointer flex items-center justify-center w-[35px] h-[35px] rounded-full transition-all ${
            showMenu
              ? "bg-zinc-700 light:bg-slate-200"
              : "hover:bg-zinc-700 light:hover:bg-slate-200"
          }`}
        >
          <SlidersHorizontal
            size={18}
            className={
              showMenu
                ? "text-white light:text-slate-800"
                : "text-zinc-300 light:text-slate-600 group-hover:text-white light:group-hover:text-slate-800"
            }
          />
        </button>

        {showMenu && (
          <div
            ref={menuRef}
            className="absolute right-0 top-[42px] bg-zinc-800 light:bg-slate-50 border border-zinc-700 light:border-slate-300 rounded-lg p-3.5 w-[226px] flex flex-col gap-1.5 shadow-lg"
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
      <SettingsButton />
      <UserButton inline />
    </div>
  );
}

export default memo(ChatSettingsMenu);
