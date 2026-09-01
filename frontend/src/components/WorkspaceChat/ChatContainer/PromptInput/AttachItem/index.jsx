import { Database, FolderOpen, Plus, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useContext, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Workspace from "@/models/workspace";
import {
  ATTACHMENTS_PROCESSED_EVENT,
  DndUploaderContext,
  REMOVE_ATTACHMENT_EVENT,
} from "../../DnDWrapper";
import ParsedFilesMenu from "./ParsedFilesMenu";

export default function AttachItem({
  workspaceSlug = null,
  workspaceThreadSlug = null,
}) {
  const { t } = useTranslation();
  const params = useParams();
  const slug = workspaceSlug || params.slug;
  const threadSlug = workspaceThreadSlug ?? params.threadSlug ?? null;
  const { ready, queueWorkspaceFiles } = useContext(DndUploaderContext);
  const menuRef = useRef(null);
  const workspaceInputRef = useRef(null);
  const parsedMenuRef = useRef(null);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [files, setFiles] = useState([]);
  const [currentTokens, setCurrentTokens] = useState(0);
  const [contextWindow, setContextWindow] = useState(Infinity);
  const [showMenu, setShowMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFiles = () => {
    if (!slug || isEmbedding) return;
    setIsLoading(true);
    Workspace.getParsedFiles(slug, threadSlug)
      .then(({ files, contextWindow, currentContextTokenCount }) => {
        setFiles(files);
        setContextWindow(contextWindow);
        setCurrentTokens(currentContextTokenCount);
      })
      .finally(() => setIsLoading(false));
  };

  async function handleRemoveAttachment(event) {
    const { document, type } = event.detail;
    if (type === "workspace_file" || !document?.id) return;
    await Workspace.deleteParsedFiles(slug, [document.id]);
    fetchFiles();
  }

  function chooseRagUpload() {
    setShowMenu(false);
    document?.getElementById("dnd-chat-file-uploader")?.click();
  }

  function chooseWorkspaceUpload() {
    setShowMenu(false);
    workspaceInputRef.current?.click();
  }

  async function handleWorkspaceFiles(event) {
    const selectedFiles = [...(event.target.files || [])];
    event.target.value = "";
    if (selectedFiles.length) await queueWorkspaceFiles(selectedFiles);
  }

  useEffect(() => {
    parsedMenuRef.current = { close: () => setShowMenu(false) };
  }, []);

  useEffect(() => {
    fetchFiles();
    window.addEventListener(ATTACHMENTS_PROCESSED_EVENT, fetchFiles);
    window.addEventListener(REMOVE_ATTACHMENT_EVENT, handleRemoveAttachment);
    return () => {
      window.removeEventListener(ATTACHMENTS_PROCESSED_EVENT, fetchFiles);
      window.removeEventListener(
        REMOVE_ATTACHMENT_EVENT,
        handleRemoveAttachment
      );
    };
  }, [slug, threadSlug]);

  useEffect(() => {
    if (!showMenu) return;
    function closeOnOutsideClick(event) {
      if (!menuRef.current?.contains(event.target)) setShowMenu(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setShowMenu(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showMenu]);

  return (
    <div ref={menuRef} className="relative">
      <button
        id="attach-item-btn"
        title={t("chat_window.upload_menu.open")}
        aria-label={t("chat_window.upload_menu.open")}
        aria-haspopup="menu"
        aria-expanded={showMenu}
        type="button"
        onClick={() => {
          setShowMenu((visible) => !visible);
          fetchFiles();
        }}
        className="group relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-none hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 light:hover:bg-slate-200"
      >
        <Plus
          size={18}
          className="pointer-events-none shrink-0 text-zinc-300 group-hover:text-white light:text-slate-600 light:group-hover:text-slate-800"
          weight="bold"
        />
        {files.length > 0 && (
          <span className="absolute -right-2 -top-2.5 flex min-w-4 items-center justify-center rounded-full bg-white px-1 text-[8px] tabular-nums text-black light:invert">
            {files.length}
          </span>
        )}
      </button>

      <input
        ref={workspaceInputRef}
        type="file"
        multiple
        hidden
        onChange={handleWorkspaceFiles}
      />

      {showMenu && (
        <div
          role="menu"
          aria-label={t("chat_window.upload_menu.title")}
          className="fixed bottom-24 left-4 right-4 z-99 w-auto overflow-hidden rounded-xl border border-zinc-700/80 bg-theme-bg-primary sm:absolute sm:bottom-9 sm:left-0 sm:right-auto sm:w-[min(380px,calc(100vw-32px))] light:border-slate-300"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 light:border-slate-200">
            <div>
              <p className="text-sm font-semibold text-theme-text-primary">
                {t("chat_window.upload_menu.title")}
              </p>
              <p className="mt-0.5 text-[11px] text-theme-text-secondary">
                {t("chat_window.upload_menu.description")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowMenu(false)}
              aria-label={t("chat_window.upload_menu.close")}
              className="flex h-8 w-8 items-center justify-center rounded-lg border-none bg-transparent text-theme-text-secondary hover:bg-theme-bg-secondary hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <UploadDestination
              icon={Database}
              title={t("chat_window.upload_menu.rag_title")}
              description={t("chat_window.upload_menu.rag_description")}
              onClick={chooseRagUpload}
              disabled={!ready}
            />
            <UploadDestination
              icon={FolderOpen}
              title={t("chat_window.upload_menu.workspace_title")}
              description={t("chat_window.upload_menu.workspace_description")}
              onClick={chooseWorkspaceUpload}
            />
          </div>

          {(isLoading || files.length > 0) && (
            <div className="border-t border-zinc-800 light:border-slate-200">
              <ParsedFilesMenu
                onEmbeddingChange={setIsEmbedding}
                tooltipRef={parsedMenuRef}
                isLoading={isLoading}
                files={files}
                setFiles={setFiles}
                currentTokens={currentTokens}
                setCurrentTokens={setCurrentTokens}
                contextWindow={contextWindow}
                workspaceSlug={slug}
                threadSlug={threadSlug}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UploadDestination({
  icon: Icon,
  title,
  description,
  onClick,
  disabled = false,
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-[88px] items-start gap-3 rounded-lg border border-zinc-700/70 bg-zinc-800/40 p-3 text-left transition-colors hover:border-cyan-300/35 hover:bg-cyan-300/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-40 light:border-slate-200 light:bg-slate-50 light:hover:border-cyan-600/30 light:hover:bg-cyan-50"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-300 light:bg-cyan-100 light:text-cyan-700">
        <Icon size={18} weight="duotone" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-theme-text-primary">
          {title}
        </span>
        <span className="mt-1 block text-[11px] leading-4 text-theme-text-secondary">
          {description}
        </span>
      </span>
    </button>
  );
}
