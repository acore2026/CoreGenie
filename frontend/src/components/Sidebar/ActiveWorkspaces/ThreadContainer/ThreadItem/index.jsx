import useScrollActiveItemIntoView from "@/hooks/useScrollActiveItemIntoView";
import Workspace from "@/models/workspace";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import {
  ArrowCounterClockwise,
  CircleNotch,
  DotsThree,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CLOSE_MOBILE_SIDEBAR_EVENT,
  THREAD_RENAME_EVENT,
} from "../../../events";
import {
  conversationRuntimeKey,
  subscribeConversationRuntime,
} from "@/utils/chat/conversationRuntime";
import { useTranslation } from "react-i18next";
import ContextMenu from "@/components/lib/ContextMenu";
import ConfirmDialog from "@/components/lib/ConfirmDialog";

export default function ThreadItem({
  isActive,
  workspace,
  thread,
  onRemove,
  toggleMarkForDeletion,
  ctrlPressed = false,
}) {
  const { t } = useTranslation();
  const { slug: urlSlug, threadSlug = null } = useParams();
  const navigate = useNavigate();
  const workspaceSlug = workspace?.slug ?? urlSlug;
  const optionsContainer = useRef(null);
  const renameInputRef = useRef(null);
  const renameSavingRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const [showOptions, setShowOptions] = useState(false);
  const [contextPoint, setContextPoint] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(thread.name);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canModify =
    workspace.viewerAccess !== "public_readonly" && thread.canModify !== false;
  const ownerName = thread.owner?.username;
  const ownerLabel = ownerName
    ? t("chat_window.thread_by", { username: ownerName })
    : null;
  const threadTooltip = ownerLabel
    ? `${thread.name} · ${ownerLabel}`
    : thread.name;
  const linkTo = thread.virtual
    ? "/"
    : !thread.slug
      ? paths.workspace.chat(workspaceSlug)
      : paths.workspace.thread(workspaceSlug, thread.slug);

  const { ref } = useScrollActiveItemIntoView({
    isActive: isActive && Boolean(thread.slug),
    behavior: "instant",
    block: "nearest",
  });

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (!workspaceSlug || thread.virtual || thread.deleted) {
      setIsProcessing(false);
      return;
    }
    const runtimeKey = conversationRuntimeKey(workspaceSlug, thread.slug);
    return subscribeConversationRuntime(runtimeKey, (runtime) => {
      setIsProcessing(
        Boolean(
          runtime?.requestInFlight ||
            runtime?.loadingResponse ||
            runtime?.socketId
        )
      );
    });
  }, [workspaceSlug, thread.slug, thread.virtual, thread.deleted]);

  function startInlineRename() {
    if (!canModify || !thread.slug || thread.virtual || thread.deleted) return;
    setShowOptions(false);
    renameCancelledRef.current = false;
    setRenameValue(thread.name);
    setRenaming(true);
  }

  async function commitInlineRename() {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }
    if (renameSavingRef.current) return;
    const name = renameValue.trim();
    if (!name || name === thread.name) {
      setRenameValue(thread.name);
      setRenaming(false);
      return;
    }

    renameSavingRef.current = true;
    const { thread: updatedThread, message } = await Workspace.threads.update(
      workspace.slug,
      thread.slug,
      { name }
    );
    renameSavingRef.current = false;
    if (!updatedThread) {
      showToast(message || t("workspace_list.rename_failed"), "error", {
        clear: true,
      });
      renameInputRef.current?.focus();
      return;
    }
    window.dispatchEvent(
      new CustomEvent(THREAD_RENAME_EVENT, {
        detail: {
          workspaceSlug,
          threadSlug: thread.slug,
          newName: updatedThread.name,
        },
      })
    );
    setRenaming(false);
  }

  function requestDelete() {
    setShowOptions(false);
    setContextPoint(null);
    setDeleteDialogOpen(true);
  }

  async function deleteThread() {
    if (deleting) return;
    setDeleting(true);
    const success = await Workspace.threads
      .delete(workspace.slug, thread.slug)
      .catch(() => false);
    setDeleting(false);
    if (!success) {
      showToast(t("workspace_list.delete_failed"), "error", { clear: true });
      return;
    }
    setDeleteDialogOpen(false);
    showToast(t("workspace_list.deleted"), "success", { clear: true });
    onRemove(thread.id);
    if (urlSlug === workspaceSlug && threadSlug === thread.slug)
      navigate(paths.workspace.chat(workspace.slug));
  }

  return (
    <>
      <div
        className="relative flex min-h-9 w-full items-center pl-4"
        role="listitem"
      >
        <div
          className={`group/thread relative flex min-h-9 min-w-0 flex-1 items-center justify-between ${isActive ? "bg-theme-sidebar-subitem-selected" : "hover:bg-theme-sidebar-subitem-hover focus-within:bg-theme-sidebar-subitem-hover"}`}
          onContextMenu={(event) => {
            if (!canModify || !thread.slug || thread.virtual || thread.deleted)
              return;
            event.preventDefault();
            setShowOptions(false);
            setContextPoint({ x: event.clientX, y: event.clientY });
          }}
        >
          {thread.deleted ? (
            <div className="w-full flex justify-between">
              <div className="w-full pl-2 py-1">
                <p
                  className={`text-left text-sm text-slate-400/50 light:text-slate-500 italic`}
                >
                  {t("workspace_list.marked_delete")}
                </p>
              </div>
              {canModify && ctrlPressed && (
                <button
                  type="button"
                  aria-label={t("workspace_list.undo_mark")}
                  className="flex h-9 w-8 shrink-0 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
                  onClick={() => toggleMarkForDeletion(thread.id)}
                >
                  <ArrowCounterClockwise
                    className="text-zinc-300 hover:text-white light:text-theme-text-secondary hover:light:text-theme-text-primary"
                    size={18}
                  />
                </button>
              )}
            </div>
          ) : renaming ? (
            <div className="w-full pl-1 py-0.5 pr-1">
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={commitInlineRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    renameCancelledRef.current = true;
                    setRenameValue(thread.name);
                    setRenaming(false);
                  }
                }}
                aria-label={t("workspace_list.rename_thread")}
                className="h-8 w-full border border-theme-sidebar-border bg-theme-bg-chat px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-button-primary"
              />
            </div>
          ) : (
            <Link
              ref={ref}
              to={linkTo}
              onClick={() => {
                window.dispatchEvent(new Event(CLOSE_MOBILE_SIDEBAR_EVENT));
              }}
              data-tooltip-id="workspace-thread-name"
              data-tooltip-content={threadTooltip}
              title={threadTooltip}
              className={`flex min-h-9 w-full min-w-0 items-center gap-1.5 overflow-hidden py-1 pl-4 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary ${
                ctrlPressed
                  ? "md:pr-8"
                  : "md:group-hover/thread:pr-8 md:group-focus-within/thread:pr-8"
              }`}
              aria-current={isActive ? "page" : ""}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`m-0 truncate text-left text-[15px] leading-5 ${
                    isActive
                      ? "font-medium text-theme-text-primary"
                      : "text-theme-text-secondary font-normal"
                  }`}
                >
                  {thread.name}
                </p>
              </div>
              {isProcessing && (
                <span
                  title={t("chat_window.thread_processing")}
                  aria-label={t("chat_window.thread_processing")}
                  className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300 light:bg-cyan-600/10 light:text-cyan-700"
                >
                  <CircleNotch
                    size={13}
                    weight="bold"
                    className="animate-spin"
                  />
                </span>
              )}
            </Link>
          )}
          {canModify && !!thread.slug && !thread.deleted && !thread.virtual && (
            <div
              ref={optionsContainer}
              className="flex items-center md:absolute md:inset-y-0 md:right-0"
            >
              {ctrlPressed ? (
                <button
                  type="button"
                  aria-label={t("workspace_list.mark_delete")}
                  className="flex h-9 w-8 shrink-0 items-center justify-center bg-transparent hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
                  onClick={() => toggleMarkForDeletion(thread.id)}
                >
                  <X
                    className="text-zinc-300 light:text-theme-text-secondary hover:text-white hover:light:text-theme-text-primary"
                    weight="bold"
                    size={18}
                  />
                </button>
              ) : (
                <div
                  className={`flex items-center ${showOptions ? "" : "md:pointer-events-none md:opacity-0 md:group-hover/thread:pointer-events-auto md:group-hover/thread:opacity-100 md:group-focus-within/thread:pointer-events-auto md:group-focus-within/thread:opacity-100"}`}
                >
                  <button
                    type="button"
                    className="flex h-9 w-8 shrink-0 items-center justify-center bg-transparent hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary"
                    onClick={() => {
                      setContextPoint(null);
                      setShowOptions(!showOptions);
                    }}
                    aria-label={t("workspace_list.thread_options")}
                    aria-expanded={showOptions}
                  >
                    <DotsThree
                      className="text-slate-300 light:text-theme-text-secondary hover:text-white hover:light:text-theme-text-primary"
                      size={22}
                    />
                  </button>
                </div>
              )}
              {showOptions && (
                <OptionsMenu
                  containerRef={optionsContainer}
                  onStartRename={startInlineRename}
                  onRequestDelete={requestDelete}
                  close={() => setShowOptions(false)}
                />
              )}
            </div>
          )}
          {contextPoint && (
            <ContextMenu
              point={contextPoint}
              label={t("workspace_list.thread_options")}
              onClose={() => setContextPoint(null)}
              width={160}
            >
              <ThreadMenuItems
                onStartRename={startInlineRename}
                onRequestDelete={requestDelete}
                close={() => setContextPoint(null)}
              />
            </ContextMenu>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        title={t("workspace_list.delete_thread")}
        description={t("workspace_list.delete_confirm")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("workspace_list.delete_thread")}
        busy={deleting}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={deleteThread}
      />
    </>
  );
}

function OptionsMenu({ containerRef, onStartRename, onRequestDelete, close }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuRef.current || !containerRef.current) return;
    menuRef.current.querySelector("button")?.focus();

    const outsideClick = (event) => {
      if (
        !menuRef.current?.contains(event.target) &&
        !containerRef.current?.contains(event.target)
      )
        close();
    };
    const isEsc = (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
        close();
        containerRef.current?.querySelector("button")?.focus();
      }
    };

    window.addEventListener("click", outsideClick);
    window.addEventListener("keydown", isEsc, true);
    return () => {
      window.removeEventListener("click", outsideClick);
      window.removeEventListener("keydown", isEsc, true);
    };
  }, [close, containerRef]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="dsh-menu absolute right-0 top-9 z-[70] min-w-[160px]"
    >
      <ThreadMenuItems
        onStartRename={onStartRename}
        onRequestDelete={onRequestDelete}
        close={close}
      />
    </div>
  );
}

function ThreadMenuItems({ onStartRename, onRequestDelete, close }) {
  const { t } = useTranslation();

  return (
    <>
      <button
        onClick={() => {
          close();
          onStartRename();
        }}
        type="button"
        role="menuitem"
        className="dsh-menu-item"
      >
        <PencilSimple size={17} />
        <span>{t("workspace_list.rename_thread")}</span>
      </button>
      <button
        onClick={() => {
          close();
          onRequestDelete();
        }}
        type="button"
        role="menuitem"
        className="dsh-menu-item dsh-menu-item-danger"
      >
        <Trash size={17} />
        <span>{t("workspace_list.delete_thread")}</span>
      </button>
    </>
  );
}
