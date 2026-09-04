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

const THREAD_CALLOUT_DETAIL_WIDTH = 26;
export default function ThreadItem({
  idx,
  activeIdx,
  isActive,
  workspace,
  thread,
  onRemove,
  toggleMarkForDeletion,
  hasNext,
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
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(thread.name);
  const [isProcessing, setIsProcessing] = useState(false);
  const canModify = thread.canModify !== false;
  const ownerName = thread.owner?.username;
  const linkTo = thread.virtual
    ? "/"
    : !thread.slug
      ? paths.workspace.chat(workspaceSlug)
      : paths.workspace.thread(workspaceSlug, thread.slug);

  const { ref } = useScrollActiveItemIntoView({
    isActive,
    behavior: "instant",
    block: "center",
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
      showToast(`Thread could not be renamed! ${message || ""}`, "error", {
        clear: true,
      });
      renameInputRef.current?.focus();
      return;
    }
    window.dispatchEvent(
      new CustomEvent(THREAD_RENAME_EVENT, {
        detail: { threadSlug: thread.slug, newName: updatedThread.name },
      })
    );
    setRenaming(false);
  }

  return (
    <div
      className={`w-full relative flex ${ownerName ? "h-[46px]" : "h-[38px]"} items-center border-none rounded-lg`}
      role="listitem"
    >
      {/* Curved line Element and leader if required */}
      <div
        style={{ width: THREAD_CALLOUT_DETAIL_WIDTH / 2 }}
        className={`${
          isActive
            ? "border-l-2 border-b-2 border-white light:border-blue-800 z-[2]"
            : "border-l border-b border-zinc-500 light:border-slate-400 z-[1]"
        } h-[50%] absolute top-0 left-3 rounded-bl-lg`}
      ></div>
      {/* Downstroke border for next item */}
      {hasNext && (
        <div
          style={{ width: THREAD_CALLOUT_DETAIL_WIDTH / 2 }}
          className={`${
            idx <= activeIdx && !isActive
              ? "border-l-2 border-white light:border-blue-800 z-[2]"
              : "border-l border-zinc-500 light:border-slate-400 z-[1]"
          } h-[100%] absolute top-0 left-3`}
        ></div>
      )}

      {/* Curved line inline placeholder for spacing - not visible */}
      <div
        style={{ width: THREAD_CALLOUT_DETAIL_WIDTH + 8 }}
        className="h-full shrink-0"
      />
      <div
        className={`group/thread relative flex min-w-0 flex-1 items-center justify-between pr-2 ${isActive ? "bg-[var(--theme-sidebar-thread-selected)] light:bg-blue-200" : "hover:bg-theme-sidebar-subitem-hover light:hover:bg-slate-300"} rounded-[4px]`}
      >
        {thread.deleted ? (
          <div className="w-full flex justify-between">
            <div className="w-full pl-2 py-1">
              <p
                className={`text-left text-sm text-slate-400/50 light:text-slate-500 italic`}
              >
                deleted thread
              </p>
            </div>
            {canModify && ctrlPressed && (
              <button
                type="button"
                className="border-none"
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
              aria-label="Rename thread"
              className="h-7 w-full rounded-md border border-sky-400/70 bg-zinc-950 light:bg-white px-2 text-sm font-medium text-white light:text-slate-900 outline-none ring-2 ring-sky-400/15"
            />
          </div>
        ) : (
          <Link
            ref={ref}
            to={linkTo}
            onClick={(event) => {
              window.dispatchEvent(new Event(CLOSE_MOBILE_SIDEBAR_EVENT));
              if (!canModify || !isActive || !thread.slug || thread.virtual)
                return;
              event.preventDefault();
              startInlineRename();
            }}
            data-tooltip-id="workspace-thread-name"
            data-tooltip-content={thread.name}
            className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden py-1 pl-2"
            aria-current={isActive ? "page" : ""}
          >
            <div className="min-w-0 flex-1">
              <p
                className={`m-0 truncate text-left text-sm ${
                  isActive
                    ? "font-semibold text-theme-text-primary light:text-blue-900"
                    : "text-theme-text-primary font-medium light:text-slate-800"
                }`}
              >
                {thread.name}
              </p>
              {ownerName && (
                <p className="m-0 truncate text-left text-[10px] font-medium leading-3 text-theme-text-secondary/70">
                  {t("chat_window.thread_by", { username: ownerName })}
                </p>
              )}
            </div>
            {isProcessing && (
              <span
                title={t("chat_window.thread_processing")}
                aria-label={t("chat_window.thread_processing")}
                className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300 light:bg-cyan-600/10 light:text-cyan-700"
              >
                <CircleNotch size={13} weight="bold" className="animate-spin" />
              </span>
            )}
          </Link>
        )}
        {canModify && !!thread.slug && !thread.deleted && !thread.virtual && (
          <div ref={optionsContainer} className="flex items-center">
            {" "}
            {/* Added flex and items-center */}
            {ctrlPressed ? (
              <button
                type="button"
                className="border-none"
                onClick={() => toggleMarkForDeletion(thread.id)}
              >
                <X
                  className="text-zinc-300 light:text-theme-text-secondary hover:text-white hover:light:text-theme-text-primary"
                  weight="bold"
                  size={18}
                />
              </button>
            ) : (
              <div className="flex items-center w-fit md:invisible md:group-hover/thread:visible md:group-focus-within/thread:visible gap-x-1">
                <button
                  type="button"
                  className="border-none"
                  onClick={() => setShowOptions(!showOptions)}
                  aria-label="Thread options"
                >
                  <DotsThree
                    className="text-slate-300 light:text-theme-text-secondary hover:text-white hover:light:text-theme-text-primary"
                    size={25}
                  />
                </button>
              </div>
            )}
            {showOptions && (
              <OptionsMenu
                containerRef={optionsContainer}
                workspace={workspace}
                thread={thread}
                onRemove={onRemove}
                onStartRename={startInlineRename}
                close={() => setShowOptions(false)}
                currentThreadSlug={threadSlug}
                navigate={navigate}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OptionsMenu({
  containerRef,
  workspace,
  thread,
  onRemove,
  onStartRename,
  close,
  currentThreadSlug,
  navigate,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuRef.current || !containerRef.current) return;

    const outsideClick = (event) => {
      if (
        !menuRef.current?.contains(event.target) &&
        !containerRef.current?.contains(event.target)
      )
        close();
    };
    const isEsc = (event) => {
      if (event.key === "Escape" || event.key === "Esc") close();
    };

    window.addEventListener("click", outsideClick);
    window.addEventListener("keyup", isEsc);
    return () => {
      window.removeEventListener("click", outsideClick);
      window.removeEventListener("keyup", isEsc);
    };
  }, [close, containerRef]);

  const renameThread = async () => {
    close();
    onStartRename();
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Are you sure you want to delete this thread? All of its chats will be deleted. You cannot undo this."
      )
    )
      return;
    const success = await Workspace.threads.delete(workspace.slug, thread.slug);
    if (!success) {
      showToast("Thread could not be deleted!", "error", { clear: true });
      return;
    }
    if (success) {
      showToast("Thread deleted successfully!", "success", { clear: true });
      onRemove(thread.id);
      // Redirect if deleting the active thread
      if (currentThreadSlug === thread.slug) {
        navigate(paths.workspace.chat(workspace.slug));
      }
      return;
    }
  };

  return (
    <div
      ref={menuRef}
      className="absolute w-fit z-[20] top-[25px] right-[10px] bg-zinc-900 light:bg-theme-bg-sidebar light:border-[1px] light:border-theme-sidebar-border rounded-lg p-1"
    >
      <button
        onClick={renameThread}
        type="button"
        className="w-full rounded-md flex items-center p-2 gap-x-2 hover:bg-slate-500/20 text-slate-300 light:text-theme-text-primary"
      >
        <PencilSimple size={18} />
        <p className="text-sm">Rename</p>
      </button>
      <button
        onClick={handleDelete}
        type="button"
        className="w-full rounded-md flex items-center p-2 gap-x-2 hover:bg-red-500/20 text-slate-300 light:text-theme-text-primary hover:text-red-100"
      >
        <Trash size={18} />
        <p className="text-sm">Delete Thread</p>
      </button>
    </div>
  );
}
