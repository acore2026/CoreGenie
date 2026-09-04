import Workspace from "@/models/workspace";
import { ChatCircleText, CircleNotch, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import ThreadItem from "./ThreadItem";
import { useNavigate, useParams } from "react-router-dom";
import useHoverMetaKey from "./hooks";
import { THREAD_CREATED_EVENT, THREAD_RENAME_EVENT } from "../../events";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import { useTranslation } from "react-i18next";

export { THREAD_CREATED_EVENT, THREAD_RENAME_EVENT } from "../../events";

const threadCache = new Map();

export default function ThreadContainer({ workspace, canCreate = true }) {
  const { t } = useTranslation();
  const { threadSlug = null } = useParams();
  const navigate = useNavigate();
  const cached = threadCache.get(workspace.slug);
  const [threads, setThreads] = useState(() => cached?.threads || []);
  const [defaultThreadHasChats, setDefaultThreadHasChats] = useState(
    () => cached?.defaultThreadHasChats || false
  );
  const [loading, setLoading] = useState(() => !cached);
  const [creatingThread, setCreatingThread] = useState(false);

  function updateThreads(updater) {
    setThreads((current) => {
      const next = updater(current);
      const previousCache = threadCache.get(workspace.slug) || {};
      threadCache.set(workspace.slug, {
        ...previousCache,
        threads: next,
      });
      return next;
    });
  }

  const { containerRef, ctrlPressed } = useHoverMetaKey(
    updateThreads,
    !loading
  );

  useEffect(() => {
    const chatHandler = (event) => {
      const { threadSlug, newName } = event.detail;
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
          : [...current, thread]
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
    async function fetchThreads() {
      if (!workspace.slug) return;
      const { threads: nextThreads, defaultThreadChatCount } =
        await Workspace.threads.all(workspace.slug);
      const nextDefaultThreadHasChats = defaultThreadChatCount > 0;
      threadCache.set(workspace.slug, {
        threads: nextThreads,
        defaultThreadHasChats: nextDefaultThreadHasChats,
      });
      setLoading(false);
      setThreads(nextThreads);
      setDefaultThreadHasChats(nextDefaultThreadHasChats);
    }
    fetchThreads();
  }, [workspace.slug]);

  const toggleForDeletion = (id) => {
    updateThreads((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        return { ...t, deleted: !t.deleted };
      })
    );
  };

  const handleDeleteAll = async () => {
    const slugs = threads.filter((t) => t.deleted === true).map((t) => t.slug);
    await Workspace.threads.deleteBulk(workspace.slug, slugs);
    updateThreads((prev) => prev.filter((t) => !t.deleted));

    // Only redirect if current thread is being deleted
    if (slugs.includes(threadSlug)) {
      navigate(paths.workspace.chat(workspace.slug));
    }
  };

  function removeThread(threadId) {
    updateThreads((prev) => prev.filter((thread) => thread.id !== threadId));
  }

  function getActiveThreadIdx() {
    const idx = threads.findIndex((t) => t?.slug === threadSlug);
    if (idx >= 0) return idx + (defaultThreadHasChats ? 1 : 0);
    if (!threadSlug && defaultThreadHasChats) return 0;
    return -1;
  }

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
      navigate(paths.workspace.thread(workspace.slug, thread.slug));
    } finally {
      setCreatingThread(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col bg-pulse w-full h-10 items-center justify-center">
        <p className="text-xs text-white animate-pulse">loading threads....</p>
      </div>
    );
  }

  const activeThreadIdx = getActiveThreadIdx();

  return (
    <div
      ref={containerRef}
      className="flex flex-col"
      role="list"
      aria-label="Threads"
    >
      {canCreate && (
        <div role="listitem" className="flex h-[38px] w-full items-center">
          <div className="w-[34px] shrink-0" aria-hidden="true" />
          <button
            type="button"
            onClick={createThread}
            disabled={creatingThread}
            aria-busy={creatingThread}
            className="group flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[4px] px-2 text-left text-sm font-semibold text-cyan-300 transition-[background-color,color,transform] duration-150 hover:bg-cyan-300/10 hover:text-cyan-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50 light:text-cyan-700 light:hover:bg-cyan-50 light:hover:text-cyan-800"
          >
            {creatingThread ? (
              <CircleNotch size={16} weight="bold" className="animate-spin" />
            ) : (
              <ChatCircleText size={16} weight="bold" />
            )}
            <span className="truncate">
              {creatingThread
                ? t("sidebar-create.creating-thread")
                : t("sidebar-create.thread")}
            </span>
          </button>
        </div>
      )}
      {defaultThreadHasChats && (
        <ThreadItem
          idx={0}
          activeIdx={activeThreadIdx}
          isActive={activeThreadIdx === 0}
          workspace={workspace}
          thread={{ slug: null, name: "default" }}
          hasNext={threads.length > 0}
        />
      )}
      {threads.map((thread, i) => (
        <ThreadItem
          key={thread.slug}
          idx={i + (defaultThreadHasChats ? 1 : 0)}
          ctrlPressed={ctrlPressed}
          toggleMarkForDeletion={toggleForDeletion}
          activeIdx={activeThreadIdx}
          isActive={activeThreadIdx === i + (defaultThreadHasChats ? 1 : 0)}
          workspace={workspace}
          onRemove={removeThread}
          thread={thread}
          hasNext={i !== threads.length - 1}
        />
      ))}
      <DeleteAllThreadButton
        ctrlPressed={ctrlPressed}
        threads={threads}
        onDelete={handleDeleteAll}
      />
    </div>
  );
}

function DeleteAllThreadButton({ ctrlPressed, threads, onDelete }) {
  if (!ctrlPressed || threads.filter((t) => t.deleted).length === 0)
    return null;
  return (
    <button
      type="button"
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
          Delete Selected
        </p>
      </div>
    </button>
  );
}
