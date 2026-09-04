import React, { useEffect, useRef, useState } from "react";
import Workspace from "@/models/workspace";
import LoadingChat from "./LoadingChat";
import ChatContainer from "./ChatContainer";
import paths from "@/utils/paths";
import ModalWrapper from "../ModalWrapper";
import { useNavigate, useParams } from "react-router-dom";
import {
  DnDFileUploaderProvider,
  DndUploaderContext,
  PASTE_ATTACHMENT_EVENT,
} from "./ChatContainer/DnDWrapper";
import {
  ArrowClockwise,
  CircleNotch,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  TTSProvider,
  useWatchForAutoPlayAssistantTTSResponse,
} from "../contexts/TTSProvider";
import { PENDING_HOME_MESSAGE } from "@/utils/constants";
import { useTranslation } from "react-i18next";
import { getConversationRuntime } from "@/utils/chat/conversationRuntime";

const conversationCache = new Map();
const CONVERSATION_LOAD_TIMEOUT_MS = 15_000;

export default function WorkspaceChat({
  loading,
  workspace,
  requestedWorkspaceSlug = workspace?.slug,
}) {
  const { t } = useTranslation();
  useWatchForAutoPlayAssistantTTSResponse();
  const { threadSlug = null } = useParams();
  const navigate = useNavigate();
  // Stores { key, workspace, history } currently rendered. Lags the props so
  // the previous chat stays mounted until the next one's history is ready,
  // avoiding a skeleton/loader flash on workspace/thread switches.
  const [loaded, setLoaded] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pendingFilesRef = useRef([]);
  const requestedKey = requestedWorkspaceSlug
    ? `${requestedWorkspaceSlug}:${threadSlug ?? "default"}`
    : "none";

  // When the thread becomes available and we have pending files, trigger upload
  useEffect(() => {
    if (loaded?.threadSlug && pendingFilesRef.current.length > 0) {
      const files = pendingFilesRef.current;
      pendingFilesRef.current = [];
      window.dispatchEvent(
        new CustomEvent(PASTE_ATTACHMENT_EVENT, { detail: { files } })
      );
    }
  }, [loaded?.threadSlug]);

  async function handleDropWithoutThread(acceptedFiles) {
    setDragging(false);
    pendingFilesRef.current = acceptedFiles;
    const { thread } = await Workspace.threads.new(workspace.slug);
    if (thread) navigate(paths.workspace.thread(workspace.slug, thread.slug));
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CONVERSATION_LOAD_TIMEOUT_MS
    );

    async function getHistory() {
      if (loading) return;
      if (!workspace?.slug) {
        setLoaded({ key: "none", workspace: null, history: [] });
        setLoadError(null);
        return false;
      }

      const key = `${workspace.slug}:${threadSlug ?? "default"}`;
      setLoadError(null);

      const cached = conversationCache.get(key);
      if (cached) {
        const runtime = getConversationRuntime(key);
        setLoaded({
          ...cached,
          workspace,
          history: runtime?.history || cached.history,
        });
      }

      try {
        const result = threadSlug
          ? await Workspace.threads.chatHistory(workspace.slug, threadSlug, {
              signal: controller.signal,
              throwOnError: true,
            })
          : await Workspace.chatHistory(workspace.slug, {
              signal: controller.signal,
              throwOnError: true,
            });
        if (!active) return;
        const chatHistory = threadSlug ? result.history : result;
        const next = {
          key,
          workspace,
          threadSlug,
          thread: threadSlug ? result.thread : null,
          history: chatHistory,
        };
        conversationCache.set(key, next);
        const runtime = getConversationRuntime(key);
        setLoaded({
          ...next,
          history: runtime?.history || next.history,
        });
      } catch (error) {
        if (!active) return;
        setLoadError({ key, message: error.message });
      }
    }
    getHistory();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [workspace, loading, threadSlug, retryVersion]);

  const hasPendingMessage = !!sessionStorage.getItem(PENDING_HOME_MESSAGE);
  if (loaded === null) {
    if (loadError?.key === requestedKey)
      return (
        <ConversationLoadState
          failed
          onRetry={() => setRetryVersion((value) => value + 1)}
        />
      );
    if (hasPendingMessage) {
      return (
        <div className="transition-all duration-500 relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full" />
      );
    }
    return <LoadingChat />;
  }
  if (!loading && !workspace) {
    return (
      <>
        {loading === false && !workspace && (
          <ModalWrapper isOpen={true}>
            <div className="w-full max-w-2xl bg-theme-bg-secondary rounded-lg shadow border-2 border-theme-modal-border overflow-hidden">
              <div className="relative p-6 border-b rounded-t border-theme-modal-border">
                <div className="w-full flex gap-x-2 items-center">
                  <WarningCircle
                    className="text-red-500 w-6 h-6"
                    weight="fill"
                  />
                  <h3 className="text-xl font-semibold text-red-500 overflow-hidden overflow-ellipsis whitespace-nowrap">
                    Workspace not found
                  </h3>
                </div>
              </div>
              <div className="py-7 px-9 space-y-2 flex-col">
                <p className="text-white text-sm">
                  The workspace you're looking for is not available. It may have
                  been deleted or you may not have access to it.
                </p>
              </div>
              <div className="flex w-full justify-end items-center p-6 space-x-2 border-t border-theme-modal-border rounded-b">
                <a
                  href={paths.home()}
                  className="transition-all duration-300 bg-white text-black hover:opacity-60 px-4 py-2 rounded-lg text-sm"
                >
                  Return to homepage
                </a>
              </div>
            </div>
          </ModalWrapper>
        )}
        <LoadingChat />
      </>
    );
  }

  setEventDelegatorForCodeSnippets();

  const switchingConversation = loaded.key !== requestedKey;
  const currentLoadFailed =
    switchingConversation && loadError?.key === requestedKey;

  return (
    <div
      className="relative h-full min-w-0 flex-1"
      aria-busy={switchingConversation && !currentLoadFailed}
    >
      <TTSProvider>
        <DnDWrapper
          loaded={loaded}
          opts={{
            files: [],
            ready: true,
            dragging,
            setDragging,
            onDrop: handleDropWithoutThread,
            parseAttachments: () => [],
          }}
        >
          <ChatContainer
            key={loaded.key}
            workspace={loaded.workspace}
            threadSlug={loaded.threadSlug}
            thread={loaded.thread}
            knownHistory={loaded.history}
          />
        </DnDWrapper>
      </TTSProvider>
      {switchingConversation && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-theme-bg-secondary/35 px-4 backdrop-blur-[1px]">
          <ConversationLoadStatus
            failed={currentLoadFailed}
            onRetry={() => setRetryVersion((value) => value + 1)}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function ConversationLoadState({ failed = false, onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="relative flex h-full min-w-0 flex-1 items-center justify-center bg-theme-bg-secondary px-4">
      <ConversationLoadStatus failed={failed} onRetry={onRetry} t={t} />
    </div>
  );
}

function ConversationLoadStatus({ failed = false, onRetry, t }) {
  return (
    <div
      role={failed ? "alert" : "status"}
      aria-live="polite"
      className="flex min-h-12 max-w-sm items-center gap-3 rounded-lg border border-white/10 bg-theme-bg-primary/95 px-4 py-3 text-theme-text-primary light:border-slate-200"
    >
      {failed ? (
        <WarningCircle
          size={18}
          weight="fill"
          className="shrink-0 text-red-400 light:text-red-700"
        />
      ) : (
        <CircleNotch
          size={18}
          weight="bold"
          className="shrink-0 animate-spin text-cyan-300 motion-reduce:animate-none light:text-cyan-700"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-semibold">
          {t(
            failed
              ? "chat_window.conversation_load_failed"
              : "chat_window.conversation_loading"
          )}
        </p>
        {failed && (
          <p className="m-0 mt-0.5 text-xs text-theme-text-secondary">
            {t("chat_window.conversation_load_failed_description")}
          </p>
        )}
      </div>
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-cyan-300 outline-none transition-[background-color,transform] duration-150 hover:bg-cyan-300/10 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-cyan-300/60 light:text-cyan-700"
        >
          <ArrowClockwise size={14} weight="bold" />
          {t("chat_window.conversation_retry")}
        </button>
      )}
    </div>
  );
}

function DnDWrapper({ children, loaded, opts }) {
  const readOnly =
    loaded?.workspace?.viewerAccess === "public_readonly" ||
    loaded?.thread?.canModify === false;
  if (!loaded?.threadSlug || readOnly) {
    return (
      <DndUploaderContext.Provider
        value={readOnly ? { ...opts, ready: false, onDrop: () => {} } : opts}
      >
        {children}
      </DndUploaderContext.Provider>
    );
  }
  return (
    <DnDFileUploaderProvider
      workspace={loaded.workspace}
      threadSlug={loaded.threadSlug}
    >
      {children}
    </DnDFileUploaderProvider>
  );
}

// Enables us to safely markdown and sanitize all responses without risk of injection
// but still be able to attach a handler to copy code snippets on all elements
// that are code snippets.
function copyCodeSnippet(uuid) {
  const target = document.querySelector(`[data-code="${uuid}"]`);
  if (!target) return false;
  const markdown =
    target.parentElement?.parentElement?.querySelector(
      "pre:first-of-type"
    )?.innerText;
  if (!markdown) return false;

  window.navigator.clipboard.writeText(markdown);
  target.classList.add("text-green-500");
  const originalText = target.innerHTML;
  target.innerText = "Copied!";
  target.setAttribute("disabled", true);

  setTimeout(() => {
    target.classList.remove("text-green-500");
    target.innerHTML = originalText;
    target.removeAttribute("disabled");
  }, 2500);
}

// Listens and hunts for all data-code-snippet clicks.
let _codeSnippetDelegatorRegistered = false;
export function setEventDelegatorForCodeSnippets() {
  if (_codeSnippetDelegatorRegistered) return;
  _codeSnippetDelegatorRegistered = true;
  document?.addEventListener("click", function (e) {
    const target = e.target.closest("[data-code-snippet]");
    const uuidCode = target?.dataset?.code;
    if (!uuidCode) return false;
    copyCodeSnippet(uuidCode);
  });
}
