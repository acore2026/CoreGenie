import Workspace from "@/models/workspace";
import { Plus, CircleNotch, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import ThreadItem from "./ThreadItem";
import { useNavigate, useParams } from "react-router-dom";
import useHoverMetaKey from "./hooks";
import { THREAD_CREATED_EVENT, THREAD_RENAME_EVENT } from "../../events";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import { useTranslation } from "react-i18next";

export { THREAD_CREATED_EVENT, THREAD_RENAME_EVENT } from "../../events";

export default function ThreadContainer({ workspace, expanded = true }) {
  const { t } = useTranslation();
  const { slug, threadSlug = null } = useParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);
  const [defaultThreadHasChats, setDefaultThreadHasChats] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [retry, setRetry] = useState(0);
  const [deleting, setDeleting] = useState(false);
  // Fetch on first expansion, then retain state while this workspace is folded.
  const [activated, setActivated] = useState(expanded);
  const revision = useRef(0);
  useEffect(() => {
    if (expanded) setActivated(true);
    else {
      setShowAll(false);
      setThreads((current) =>
        current.some((thread) => thread.deleted)
          ? current.map((thread) => ({ ...thread, deleted: false }))
          : current
      );
    }
  }, [expanded]);

  function updateThreads(updater) {
    revision.current += 1;
    setThreads(updater);
  }

  const { containerRef, ctrlPressed } = useHoverMetaKey(
    updateThreads,
    !loading && expanded
  );

  useEffect(() => {
    const chatHandler = (event) => {
      const { threadSlug, newName, workspaceSlug } = event.detail || {};
      if (workspaceSlug && workspaceSlug !== workspace.slug) return;
      updateThreads((prevThreads) =>
        prevThreads.map((thread) => {
          if (thread.slug === threadSlug) {
            return { ...thread, name: newName };
          }
          return thread;
        })
      );
    };

    const createdHandler = (event) => {
      const { workspaceSlug, thread } = event.detail || {};
      if (workspaceSlug !== workspace.slug || !thread?.slug) return;
      updateThreads((current) =>
        current.some((item) => item.slug === thread.slug)
          ? current
          : [thread, ...current]
      );
    };

    window.addEventListener(THREAD_RENAME_EVENT, chatHandler);
    window.addEventListener(THREAD_CREATED_EVENT, createdHandler);

    return () => {
      window.removeEventListener(THREAD_RENAME_EVENT, chatHandler);
      window.removeEventListener(THREAD_CREATED_EVENT, createdHandler);
    };
  }, [workspace.slug]);

  useEffect(() => {
    if (!activated) return;
    let cancelled = false;
    async function fetchThreads() {
      if (!workspace.slug) return;
      setError(false);
      setLoading(true);
      const startedRevision = revision.current;
      try {
        const result = await Workspace.threads.all(workspace.slug, {
          throwOnError: true,
        });
        if (cancelled) return;
        if (!Array.isArray(result?.threads)) throw new Error("Invalid threads");
        // A creation/rename that finished during this request must not be overwritten.
        if (revision.current !== startedRevision) {
          setRetry((value) => value + 1);
          return;
        }
        setThreads(result.threads);
        setDefaultThreadHasChats(result.defaultThreadChatCount > 0);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchThreads();
    return () => {
      cancelled = true;
    };
  }, [workspace.slug, activated, retry]);

  const toggleForDeletion = (id) => {
    updateThreads((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        return { ...t, deleted: !t.deleted };
      })
    );
  };

  const handleDeleteAll = async () => {
    if (deleting) return;
    const slugs = threads.filter((t) => t.deleted === true).map((t) => t.slug);
    setDeleting(true);
    try {
      const success = await Workspace.threads.deleteBulk(workspace.slug, slugs);
      if (!success) throw new Error("Delete failed");
      updateThreads((prev) =>
        prev.filter((thread) => !slugs.includes(thread.slug))
      );
      if (slug === workspace.slug && slugs.includes(threadSlug)) {
        navigate(paths.workspace.chat(workspace.slug));
      }
    } catch {
      showToast(t("workspace_list.delete_failed"), "error");
    } finally {
      setDeleting(false);
    }
  };

  function removeThread(threadId) {
    updateThreads((prev) => prev.filter((thread) => thread.id !== threadId));
  }

  function getActiveThreadIdx() {
    if (slug !== workspace.slug) return -1;
    const idx = threads.findIndex((t) => t?.slug === threadSlug);
    if (idx >= 0) return idx + (defaultThreadHasChats ? 1 : 0);
    if (!threadSlug && defaultThreadHasChats) return 0;
    return -1;
  }

  if (!expanded) return null;

  if (loading) {
    return (
      <p role="status" className="py-2 pl-12 text-xs text-theme-text-secondary">
        {t("workspace_list.loading")}
      </p>
    );
  }
  if (error) {
    return (
      <button
        type="button"
        onClick={() => setRetry((value) => value + 1)}
        className="min-h-10 w-full px-8 text-left text-xs text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
      >
        {t("workspace_list.retry")}
      </button>
    );
  }

  const activeThreadIdx = getActiveThreadIdx();
  const rows = defaultThreadHasChats
    ? [{ slug: null, name: t("workspace_list.default_thread") }, ...threads]
    : threads;
  const visibleRows =
    showAll || ctrlPressed
      ? rows
      : rows.filter((_, index) => index < 5 || index === activeThreadIdx);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div
      ref={containerRef}
      className="flex flex-col"
      role="list"
      aria-label={t("workspace_list.threads", { name: workspace.name })}
    >
      {visibleRows.map((thread) => (
        <ThreadItem
          key={thread.slug ?? "default"}
          ctrlPressed={ctrlPressed}
          toggleMarkForDeletion={toggleForDeletion}
          isActive={slug === workspace.slug && thread.slug === threadSlug}
          workspace={workspace}
          onRemove={removeThread}
          thread={thread}
        />
      ))}
      {rows.length === 0 && (
        <p className="py-2 pl-12 text-xs text-theme-text-secondary">
          {t("workspace_list.empty")}
        </p>
      )}
      {!ctrlPressed && (hiddenCount > 0 || showAll) && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="min-h-10 w-full pl-12 pr-2 text-left text-xs text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary"
        >
          {showAll
            ? t("workspace_list.show_less")
            : t("workspace_list.show_more", { count: hiddenCount })}
        </button>
      )}
      <DeleteAllThreadButton
        ctrlPressed={ctrlPressed}
        threads={threads}
        onDelete={handleDeleteAll}
        deleting={deleting}
      />
    </div>
  );
}

export function CreateThreadButton({ workspace, onCreated }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [creatingThread, setCreatingThread] = useState(false);
  async function createThread() {
    if (creatingThread) return;
    setCreatingThread(true);
    try {
      const { thread, error } = await Workspace.threads.new(workspace.slug);
      if (!thread) {
        showToast(error || t("sidebar-create.thread-failed"), "error", {
          clear: true,
        });
        return;
      }
      window.dispatchEvent(
        new CustomEvent(THREAD_CREATED_EVENT, {
          detail: { workspaceSlug: workspace.slug, thread },
        })
      );
      onCreated?.();
      navigate(paths.workspace.thread(workspace.slug, thread.slug));
    } catch {
      showToast(t("sidebar-create.thread-failed"), "error", { clear: true });
    } finally {
      setCreatingThread(false);
    }
  }

  return (
    <button
      type="button"
      onClick={createThread}
      disabled={creatingThread}
      aria-busy={creatingThread}
      aria-label={t("workspace_list.create_thread", { name: workspace.name })}
      title={t("sidebar-create.thread")}
      className="flex h-9 w-8 shrink-0 items-center justify-center text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary disabled:cursor-wait disabled:opacity-50"
    >
      {creatingThread ? (
        <CircleNotch size={16} weight="bold" className="animate-spin" />
      ) : (
        <Plus size={16} />
      )}
      <span className="sr-only">
        {creatingThread
          ? t("sidebar-create.creating-thread")
          : t("sidebar-create.thread")}
      </span>
    </button>
  );
}

function DeleteAllThreadButton({ ctrlPressed, threads, onDelete, deleting }) {
  const { t } = useTranslation();
  if (!ctrlPressed || threads.filter((t) => t.deleted).length === 0)
    return null;
  return (
    <button
      type="button"
      disabled={deleting}
      aria-busy={deleting}
      onClick={onDelete}
      className="w-full relative flex h-[40px] items-center border-none hover:bg-red-400/20 rounded-lg group"
    >
      <div className="flex w-full gap-x-2 items-center pl-4">
        <div className="bg-transparent p-2 rounded-lg h-[24px] w-[24px] flex items-center justify-center">
          <Trash
            weight="bold"
            size={14}
            className="shrink-0 text-white light:text-red-500/50 group-hover:text-red-400"
          />
        </div>
        <p className="text-white light:text-theme-text-secondary text-left text-sm group-hover:text-red-400">
          {t("workspace_list.delete_selected")}
        </p>
      </div>
    </button>
  );
}
