import {
  useState,
  useEffect,
  useContext,
  useRef,
  useCallback,
  useDeferredValue,
} from "react";
import ChatHistory from "./ChatHistory";
import { CLEAR_ATTACHMENTS_EVENT, DndUploaderContext } from "./DnDWrapper";
import PromptInput, {
  PROMPT_INPUT_EVENT,
  PROMPT_INPUT_ID,
} from "./PromptInput";
import Workspace from "@/models/workspace";
import handleChat, { ABORT_STREAM_EVENT } from "@/utils/chat";
import { isMobile } from "react-device-detect";
import { SidebarMobileHeader } from "../../Sidebar";
import { useNavigate } from "react-router-dom";
import {
  AGENT_SESSION_END,
  setAgentSessionActive,
  setAgentSessionSocket,
} from "@/utils/chat/agent";
import DnDFileUploaderWrapper from "./DnDWrapper";
import SpeechRecognition, {
  useSpeechRecognition,
} from "react-speech-recognition";
import { ChatTooltips } from "./ChatTooltips";
import { MetricsProvider } from "./ChatHistory/HistoricalMessage/Actions/RenderMetrics";
import useChatContainerQuickScroll from "@/hooks/useChatContainerQuickScroll";
import { PENDING_HOME_MESSAGE } from "@/utils/constants";
import { clearPromptInputDraft } from "@/hooks/usePromptInputStorage";
import { safeJsonParse } from "@/utils/request";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";
import SuggestedMessages from "@/components/lib/SuggestedMessages";
import ChatSettingsMenu from "./ChatSettingsMenu";
import { ChatSidebarProvider } from "./ChatSidebar";
import SourcesSidebar from "./SourcesSidebar";
import MemoriesSidebar from "./MemoriesSidebar";
import WorkspaceFilesSidebar from "./WorkspaceFilesSidebar";
import AgentShowcase from "@/components/PredefinedAgents/AgentShowcase";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import { THREAD_CREATED_EVENT } from "@/components/Sidebar/ActiveWorkspaces/ThreadContainer";
import {
  claimConversationRequest,
  conversationRuntimeKey,
  initializeConversationRuntime,
  releaseConversationRequest,
  subscribeConversationRuntime,
  updateConversationHistory,
  updateConversationRuntime,
} from "@/utils/chat/conversationRuntime";
import {
  bindVisibleAgentSession,
  ensureBackgroundAgentSession,
  stopBackgroundAgentSession,
} from "@/utils/chat/backgroundAgentSession";

function useEventCallback(callback) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args) => callbackRef.current(...args), []);
}

export default function ChatContainer({
  workspace,
  threadSlug = null,
  knownHistory = [],
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const runtimeKey = conversationRuntimeKey(workspace.slug, threadSlug);
  const initialRuntime = initializeConversationRuntime(
    runtimeKey,
    knownHistory
  );
  const [loadingResponse, setLocalLoadingResponse] = useState(
    initialRuntime.loadingResponse
  );
  const [chatHistory, setLocalChatHistory] = useState(initialRuntime.history);
  const deferredChatHistory = useDeferredValue(chatHistory);
  const [socketId, setLocalSocketId] = useState(initialRuntime.socketId);
  const [websocket, setWebsocket] = useState(null);
  const { files, parseAttachments } = useContext(DndUploaderContext);
  const { chatHistoryRef } = useChatContainerQuickScroll();
  const pendingMessageChecked = useRef(false);
  const activeThreadSlug = threadSlug;
  const { selectedAgent, selectedAgentId } = usePredefinedAgent();

  const setChatHistory = useCallback(
    (updater) => updateConversationHistory(runtimeKey, updater),
    [runtimeKey]
  );
  const setLoadingResponse = useCallback(
    (loading) =>
      updateConversationRuntime(runtimeKey, { loadingResponse: loading }),
    [runtimeKey]
  );
  const setSocketId = useCallback(
    (nextSocketId) =>
      updateConversationRuntime(runtimeKey, { socketId: nextSocketId }),
    [runtimeKey]
  );

  useEffect(
    () =>
      subscribeConversationRuntime(runtimeKey, (runtime) => {
        setLocalChatHistory(runtime.history);
        setLocalLoadingResponse(runtime.loadingResponse);
        setLocalSocketId(runtime.socketId);
      }),
    [runtimeKey]
  );

  const isEmpty =
    chatHistory.length === 0 && !sessionStorage.getItem(PENDING_HOME_MESSAGE);

  /**
   * Keep chat history bottom-padding in sync with the prompt input's
   * actual rendered height so expanding input never covers messages.
   */
  useEffect(() => {
    if (isEmpty) return;
    const wrapper = document.getElementById("prompt-input-wrapper");
    const chatEl = document.getElementById("chat-history");
    if (!wrapper || !chatEl) return;

    const observer = new ResizeObserver(([entry]) => {
      const inputHeight =
        entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight;
      chatEl.style.paddingBottom = `${inputHeight}px`;
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [isEmpty]);

  const { listening, resetTranscript } = useSpeechRecognition({
    clearTranscriptOnListen: true,
  });

  /**
   * Emit an update to the state of the prompt input without directly
   * passing a prop in so that it does not re-render constantly.
   * @param {string} messageContent - The message content to set
   * @param {'replace' | 'append'} writeMode - Replace current text or append to existing text (default: replace)
   */
  function setMessageEmit(messageContent = "", writeMode = "replace") {
    window.dispatchEvent(
      new CustomEvent(PROMPT_INPUT_EVENT, {
        detail: { messageContent, writeMode },
      })
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    const currentMessage =
      document.getElementById(PROMPT_INPUT_ID)?.value || "";
    if (!currentMessage) return false;

    // Clear the localStorage draft for this thread/workspace so that if the
    // PromptInput remounts (empty→chat transition), it won't restore stale text
    clearPromptInputDraft(activeThreadSlug ?? workspace.slug);

    // If we're on a bare workspace route (no thread) and no chats exist yet,
    // create a new thread and navigate to it — mimicking Home page behavior.
    if (!activeThreadSlug && chatHistory.length === 0) {
      const { thread } = await Workspace.threads.new(workspace.slug);
      if (thread) {
        window.dispatchEvent(
          new CustomEvent(THREAD_CREATED_EVENT, {
            detail: { workspaceSlug: workspace.slug, thread },
          })
        );
        sessionStorage.setItem(
          PENDING_HOME_MESSAGE,
          JSON.stringify({
            message: currentMessage,
            attachments: parseAttachments(),
          })
        );
        navigate(paths.workspace.thread(workspace.slug, thread.slug));
        return;
      }
    }

    const prevChatHistory = [
      ...chatHistory,
      {
        content: currentMessage,
        role: "user",
        attachments: parseAttachments(),
      },
      {
        content: "",
        role: "assistant",
        pending: true,
        userMessage: currentMessage,
        animate: true,
      },
    ];

    if (listening) {
      endSTTSession();
    }
    setChatHistory(prevChatHistory);
    setMessageEmit("");
    setLoadingResponse(true);
  };

  function endSTTSession() {
    SpeechRecognition.stopListening();
    resetTranscript();
  }

  const sendCommandRef = useRef(null);

  /**
   * Send a command to the LLM prompt input.
   * @param {Object} options - Arguments to send to the LLM
   * @param {string} options.text - The text to send to the LLM
   * @param {boolean} options.autoSubmit - Determines if the text should be sent immediately or if it should be added to the message state (default: false)
   * @param {Object[]} options.history - The history of the chat prior to this message for overriding the current chat history
   * @param {Object[import("./DnDWrapper").Attachment]} options.attachments - The attachments to send to the LLM for this message
   * @param {'replace' | 'append' | 'prepend'} options.writeMode - Replace current text or append to existing text (default: replace)
   * @returns {void}
   */
  const sendCommand = async ({
    text = "",
    autoSubmit = false,
    history = [],
    attachments = [],
    writeMode = "replace",
  } = {}) => {
    // If we are not auto-submitting, we can just emit the text to the prompt input.
    if (!autoSubmit) {
      setMessageEmit(text, writeMode);
      return;
    }

    if (writeMode === "prepend") {
      const currentText = document.getElementById(PROMPT_INPUT_ID)?.value ?? "";
      text = currentText + " " + text;
    }

    // If we are auto-submitting in append mode
    // than we need to update text with whatever is in the prompt input + the text we are sending.
    // @note: `message` will not work here since it is not updated yet.
    // If text is still empty, after this, then we should just return.
    if (writeMode === "append") {
      const currentText = document.getElementById(PROMPT_INPUT_ID)?.value ?? "";
      text = currentText + text;
    }

    if (!text || text === "") return false;

    // If on a bare workspace route with no thread and no chat yet, create a
    // virtual thread and navigate — same as handleSubmit does.
    if (!activeThreadSlug && chatHistory.length === 0 && history.length === 0) {
      const { thread } = await Workspace.threads.new(workspace.slug);
      if (thread) {
        window.dispatchEvent(
          new CustomEvent(THREAD_CREATED_EVENT, {
            detail: { workspaceSlug: workspace.slug, thread },
          })
        );
        sessionStorage.setItem(
          PENDING_HOME_MESSAGE,
          JSON.stringify({ message: text, attachments })
        );
        navigate(paths.workspace.thread(workspace.slug, thread.slug));
        return;
      }
    }

    // Clear the localStorage draft so that if the PromptInput remounts
    // (e.g. /reset causing empty→chat or chat→empty transitions),
    // it won't restore stale text.
    clearPromptInputDraft(activeThreadSlug ?? workspace.slug);

    // If we are auto-submitting
    // Then we can replace the current text since this is not accumulating.
    let prevChatHistory;
    if (history.length > 0) {
      // use pre-determined history chain.
      prevChatHistory = [
        ...history,
        {
          content: "",
          role: "assistant",
          pending: true,
          userMessage: text,
          attachments,
          animate: true,
        },
      ];
    } else {
      prevChatHistory = [
        ...chatHistory,
        {
          content: text,
          role: "user",
          attachments,
        },
        {
          content: "",
          role: "assistant",
          pending: true,
          userMessage: text,
          attachments,
          animate: true,
        },
      ];
    }

    setChatHistory(prevChatHistory);
    setMessageEmit("");
    setLoadingResponse(true);
  };

  const submitPrompt = useEventCallback(handleSubmit);
  const dispatchCommand = useEventCallback(sendCommand);
  sendCommandRef.current = dispatchCommand;
  const chatHistoryRef2 = useRef(chatHistory);
  chatHistoryRef2.current = chatHistory;

  const regenerateAssistantMessage = useCallback(
    (chatId) => {
      const filteredHistory = chatHistoryRef2.current.slice(0, -1);
      const lastUserMessage = filteredHistory.findLast(
        (msg) => msg.role === "user"
      );
      Workspace.deleteChats(workspace.slug, [chatId])
        .then(() =>
          sendCommandRef.current({
            text: lastUserMessage.content,
            autoSubmit: true,
            history: filteredHistory,
            attachments: lastUserMessage?.attachments,
          })
        )
        .catch((e) => console.error(e));
    },
    [workspace.slug]
  );

  useEffect(() => {
    if (pendingMessageChecked.current || !workspace?.slug) return;
    pendingMessageChecked.current = true;

    const pending = safeJsonParse(sessionStorage.getItem(PENDING_HOME_MESSAGE));
    if (pending?.message) {
      setTimeout(() => {
        sessionStorage.removeItem(PENDING_HOME_MESSAGE);
        dispatchCommand({
          text: pending.message,
          attachments: pending.attachments || [],
          autoSubmit: true,
        });
      }, 100);
    }
  }, [workspace?.slug, dispatchCommand]);

  // A server-owned Agent run survives a browser refresh. Discover it for this
  // conversation, restore the submitted prompt, and reconnect to its buffered
  // event stream without starting the invocation again.
  useEffect(() => {
    if (socketId || !workspace?.slug) return;
    let active = true;
    Workspace.activeAgentInvocation(workspace.slug, activeThreadSlug).then(
      ({ invocation }) => {
        if (!active || !invocation?.uuid) return;
        setChatHistory((previous) => {
          const promptAlreadyVisible = previous.some(
            (message) =>
              message.role === "user" && message.content === invocation.prompt
          );
          if (promptAlreadyVisible) return previous;
          return [
            ...previous,
            {
              content: invocation.prompt,
              role: "user",
              attachments: [],
            },
          ];
        });
        setSocketId(invocation.uuid);
      }
    );
    return () => {
      active = false;
    };
  }, [
    activeThreadSlug,
    setChatHistory,
    setSocketId,
    socketId,
    workspace?.slug,
  ]);

  useEffect(() => {
    async function fetchReply() {
      if (!claimConversationRequest(runtimeKey)) return;
      try {
        const promptMessage =
          chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
        const remHistory =
          chatHistory.length > 0 ? chatHistory.slice(0, -1) : [];
        var _chatHistory = [...remHistory];

        // Override hook for new messages to now go to agents until the connection closes
        if (!!websocket) {
          if (!promptMessage || !promptMessage?.userMessage) return false;
          const attachments = promptMessage?.attachments ?? parseAttachments();
          window.dispatchEvent(new CustomEvent(CLEAR_ATTACHMENTS_EVENT));
          websocket.send(
            JSON.stringify({
              type: "awaitingFeedback",
              feedback: promptMessage?.userMessage,
              attachments,
            })
          );

          // /reset during an active agent session should end the session AND
          // clear the chat in a single action. The send above triggers the
          // server to abort the agent and close the socket; fall through to the
          // /reset flow below which resets memory + clears chat history.
          if (promptMessage.userMessage.trim() !== "/reset") {
            setLoadingResponse(false);
            return;
          }
        }

        if (!promptMessage || !promptMessage?.userMessage) return false;

        // If running and edit or regeneration, this history will already have attachments
        // so no need to parse the current state.
        const attachments = promptMessage?.attachments ?? parseAttachments();
        window.dispatchEvent(new CustomEvent(CLEAR_ATTACHMENTS_EVENT));

        await Workspace.multiplexStream({
          workspaceSlug: workspace.slug,
          threadSlug: activeThreadSlug,
          prompt: promptMessage.userMessage,
          chatHandler: (chatResult) =>
            handleChat(
              chatResult,
              setLoadingResponse,
              setChatHistory,
              remHistory,
              _chatHistory,
              setSocketId
            ),
          attachments,
          predefinedAgentId: selectedAgentId,
        });
        return;
      } finally {
        releaseConversationRequest(runtimeKey);
      }
    }
    loadingResponse === true && fetchReply();
  }, [loadingResponse, chatHistory, workspace, runtimeKey]);

  // The route-independent session owns the transport. Leaving this thread only
  // unsubscribes its UI; the Agent continues and its accumulated state is
  // replayed from the conversation runtime when the user returns.
  useEffect(() => {
    if (!socketId) return;
    ensureBackgroundAgentSession({ key: runtimeKey, socketId });
  }, [runtimeKey, socketId]);

  useEffect(() => {
    const unsubscribe = bindVisibleAgentSession(runtimeKey, (session) => {
      setWebsocket(session.active ? session.transport : null);
      setAgentSessionActive(session.active);
      setAgentSessionSocket(session.active ? session.transport : null);
      if (session.active) {
        setLoadingResponse(false);
        window.dispatchEvent(new CustomEvent(CLEAR_ATTACHMENTS_EVENT));
      }
    });

    const abortSession = () => stopBackgroundAgentSession(runtimeKey);
    window.addEventListener(ABORT_STREAM_EVENT, abortSession);
    return () => {
      unsubscribe();
      window.removeEventListener(ABORT_STREAM_EVENT, abortSession);
      setAgentSessionActive(false);
      setAgentSessionSocket(null);
      window.dispatchEvent(new CustomEvent(AGENT_SESSION_END));
    };
  }, [runtimeKey, setLoadingResponse]);

  if (isEmpty) {
    return (
      <ChatSidebarProvider>
        <div
          style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
          className="relative flex lg:gap-3 md:ml-[2px] md:mr-[16px] md:my-[16px] w-full h-full z-[2]"
        >
          <div className="relative flex-1 min-w-0 h-full">
            <ChatSettingsMenu
              hasHistory={chatHistory.length > 0}
              workspace={workspace}
              threadSlug={activeThreadSlug}
            />
            <div className="relative md:rounded-[16px] bg-zinc-900 light:bg-white w-full h-full overflow-hidden border-none light:border-solid light:border light:border-theme-modal-border">
              {isMobile && <SidebarMobileHeader />}
              <DnDFileUploaderWrapper>
                <div className="flex flex-col h-full w-full items-center justify-center">
                  <div className="flex flex-col items-center w-full max-w-[750px]">
                    <h1 className="text-white light:text-slate-900 text-xl md:text-2xl mb-7 text-center">
                      {selectedAgent?.welcomeMessage || t("main-page.greeting")}
                    </h1>
                    <PromptInput
                      workspace={workspace}
                      submit={submitPrompt}
                      isStreaming={loadingResponse}
                      sendCommand={dispatchCommand}
                      attachments={files}
                      centered={true}
                      examplePrompts={selectedAgent?.examplePrompts}
                    />
                    <AgentShowcase />
                  </div>
                  <SuggestedMessages
                    suggestedMessages={workspace?.suggestedMessages}
                    sendCommand={dispatchCommand}
                  />
                </div>
              </DnDFileUploaderWrapper>
              <ChatTooltips />
            </div>
            <MemoriesSidebar workspace={workspace} />
          </div>
          <WorkspaceFilesSidebar workspace={workspace} />
        </div>
      </ChatSidebarProvider>
    );
  }

  return (
    <ChatSidebarProvider>
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative flex lg:gap-3 md:ml-[2px] md:mr-[16px] md:my-[16px] w-full h-full z-[2]"
      >
        <div className="relative flex-1 min-w-0 h-full">
          <ChatSettingsMenu
            hasHistory={chatHistory.length > 0}
            workspace={workspace}
            threadSlug={activeThreadSlug}
          />
          <div className="relative md:rounded-[16px] bg-zinc-900 light:bg-white text-white light:text-slate-900 h-full overflow-hidden border-none light:border-solid light:border light:border-theme-modal-border">
            {isMobile && <SidebarMobileHeader />}
            <DnDFileUploaderWrapper>
              <div className="flex flex-col h-full w-full pb-20 md:pb-0">
                <div className="contents">
                  <MetricsProvider>
                    <ChatHistory
                      ref={chatHistoryRef}
                      history={deferredChatHistory}
                      workspace={workspace}
                      sendCommand={dispatchCommand}
                      updateHistory={setChatHistory}
                      regenerateAssistantMessage={regenerateAssistantMessage}
                      websocket={websocket}
                    />
                  </MetricsProvider>
                  <PromptInput
                    workspace={workspace}
                    submit={submitPrompt}
                    isStreaming={loadingResponse}
                    sendCommand={dispatchCommand}
                    attachments={files}
                    centered={false}
                    examplePrompts={selectedAgent?.examplePrompts}
                  />
                </div>
              </div>
            </DnDFileUploaderWrapper>
            <ChatTooltips />
          </div>
          <SourcesSidebar />
          <MemoriesSidebar workspace={workspace} />
        </div>
        <WorkspaceFilesSidebar workspace={workspace} />
      </div>
    </ChatSidebarProvider>
  );
}
