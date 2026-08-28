import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  forwardRef,
} from "react";
import HistoricalMessage from "./HistoricalMessage";
import PromptReply from "./PromptReply";
import ToolApprovalRequest from "./ToolApprovalRequest";
import ClarifyingQuestionCard from "./ClarifyingQuestion";
import FileDownloadCard from "./FileDownloadCard";
import ScheduledJobCreatedCard from "./ScheduledJobCreatedCard";
import { useManageWorkspaceModal } from "../../../Modals/ManageWorkspace";
import ManageWorkspace from "../../../Modals/ManageWorkspace";
import { ArrowDown } from "@phosphor-icons/react";
import Chartable from "./Chartable";
import ModelRouteNotification from "./ModelRouteNotification";
import SubagentRun from "./SubagentRun";
import ContextTrace from "./ContextTrace";
import AgentExecutionRail from "./AgentExecutionRail";
import Workspace from "@/models/workspace";
import { useNavigate, useParams } from "react-router-dom";
import paths from "@/utils/paths";
import Appearance from "@/models/appearance";
import useTextSize from "@/hooks/useTextSize";
import useChatHistoryScrollHandle from "@/hooks/useChatHistoryScrollHandle";
import { ThoughtExpansionProvider } from "./ThoughtContainer";
import { MessageActionsProvider } from "./MessageActionsContext";

export default forwardRef(function (
  {
    history = [],
    workspace,
    sendCommand,
    updateHistory,
    regenerateAssistantMessage,
    websocket = null,
    readOnly = false,
  },
  ref
) {
  const lastScrollTopRef = useRef(0);
  const lastTouchYRef = useRef(null);
  const chatHistoryRef = useRef(null);
  const isProgrammaticScroll = useRef(false);
  const { threadSlug = null } = useParams();
  const navigate = useNavigate();
  const { showing, hideModal } = useManageWorkspaceModal();
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const isStreaming = history[history.length - 1]?.animate;
  const { showScrollbar } = Appearance.getSettings();
  const { textSizeClass } = useTextSize();

  useEffect(() => {
    if (!isUserScrolling && (isAtBottom || isStreaming)) {
      scrollToBottom(false);
    }
  }, [history, isAtBottom, isStreaming, isUserScrolling]);

  const handleScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const isBottom = scrollHeight - scrollTop - clientHeight < 2;
    const scrollDelta = scrollTop - lastScrollTopRef.current;

    // Auto-follow only ever moves downward. An upward movement is therefore
    // always user intent, even if a previous no-op scrollToBottom left the
    // programmatic flag set while new Agent trace events were arriving.
    if (scrollDelta < -1) setIsUserScrolling(true);
    else if (isBottom) setIsUserScrolling(false);

    isProgrammaticScroll.current = false;
    setIsAtBottom(isBottom);
    lastScrollTopRef.current = scrollTop;
  }, []);

  const pauseAutoFollow = useCallback(() => {
    setIsUserScrolling(true);
  }, []);

  const handleWheel = useCallback(
    (event) => {
      if (event.deltaY < 0) pauseAutoFollow();
    },
    [pauseAutoFollow]
  );

  const handleTouchStart = useCallback((event) => {
    lastTouchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback(
    (event) => {
      const touchY = event.touches[0]?.clientY;
      if (touchY == null || lastTouchYRef.current == null) return;
      // A downward finger movement scrolls the chat toward older messages.
      if (touchY > lastTouchYRef.current + 2) pauseAutoFollow();
      lastTouchYRef.current = touchY;
    },
    [pauseAutoFollow]
  );

  const scrollToBottom = (smooth = false) => {
    if (chatHistoryRef.current) {
      isProgrammaticScroll.current = true;
      chatHistoryRef.current.scrollTo({
        top: chatHistoryRef.current.scrollHeight,
        ...(smooth ? { behavior: "smooth" } : {}),
      });
    }
  };

  useChatHistoryScrollHandle(ref, chatHistoryRef, {
    setIsUserScrolling,
    isStreaming,
    scrollToBottom,
  });

  const historyRef = useRef(history);
  historyRef.current = history;
  const sendCommandRef = useRef(sendCommand);
  sendCommandRef.current = sendCommand;

  const saveEditedMessage = useCallback(
    async ({
      editedMessage,
      chatId,
      role,
      attachments = [],
      saveOnly = false,
    }) => {
      if (!editedMessage) return;
      const currentHistory = historyRef.current;

      if (role === "user" && saveOnly) {
        const updatedHistory = [...currentHistory];
        const targetIdx = currentHistory.findIndex(
          (msg) => msg.chatId === chatId
        );
        if (targetIdx < 0) return;
        updatedHistory[targetIdx].content = editedMessage;
        updateHistory(updatedHistory);
        await Workspace.updateChat(
          workspace.slug,
          threadSlug,
          chatId,
          editedMessage,
          "user"
        );
        return;
      }

      if (role === "user") {
        const updatedHistory = currentHistory.slice(
          0,
          currentHistory.findIndex((msg) => msg.chatId === chatId) + 1
        );
        updatedHistory[updatedHistory.length - 1].content = editedMessage;
        await Workspace.deleteEditedChats(workspace.slug, threadSlug, chatId);
        sendCommandRef.current({
          text: editedMessage,
          autoSubmit: true,
          history: updatedHistory,
          attachments,
        });
        return;
      }

      if (role === "assistant") {
        const updatedHistory = [...currentHistory];
        const targetIdx = currentHistory.findIndex(
          (msg) => msg.chatId === chatId && msg.role === role
        );
        if (targetIdx < 0) return;
        updatedHistory[targetIdx].content = editedMessage;
        updateHistory(updatedHistory);
        await Workspace.updateChat(
          workspace.slug,
          threadSlug,
          chatId,
          editedMessage
        );
        return;
      }
    },
    [workspace.slug, threadSlug, updateHistory]
  );

  const forkThread = useCallback(
    async (chatId) => {
      const newThreadSlug = await Workspace.forkThread(
        workspace.slug,
        threadSlug,
        chatId
      );
      navigate(paths.workspace.thread(workspace.slug, newThreadSlug));
    },
    [workspace.slug, threadSlug, navigate]
  );

  const compiledHistory = useMemo(
    () =>
      buildMessages({
        workspace,
        history,
        regenerateAssistantMessage,
        saveEditedMessage,
        forkThread,
        websocket,
        readOnly,
      }),
    [
      workspace,
      history,
      regenerateAssistantMessage,
      saveEditedMessage,
      forkThread,
      websocket,
      readOnly,
    ]
  );
  return (
    <MessageActionsProvider>
      <ThoughtExpansionProvider>
        <div
          className={`markdown text-white/80 light:text-theme-text-primary font-light ${textSizeClass} h-full md:h-[83%] pb-[100px] pt-6 md:pt-0 md:pb-20 md:mx-0 overflow-y-scroll flex flex-col items-center justify-start ${showScrollbar ? "show-scrollbar" : "no-scroll"}`}
          id="chat-history"
          ref={chatHistoryRef}
          onScroll={handleScroll}
          onWheelCapture={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
        >
          <div className="w-full max-w-[750px]">{compiledHistory}</div>
          {showing && (
            <ManageWorkspace
              hideModal={hideModal}
              providedSlug={workspace.slug}
            />
          )}
        </div>
        {!isAtBottom && (
          <div className="absolute bottom-40 right-10 z-50 cursor-pointer animate-pulse">
            <div className="flex flex-col items-center">
              <div
                className="p-1 rounded-full border border-white/10 bg-white/10 hover:bg-white/20 hover:text-white"
                onClick={() => {
                  scrollToBottom(isStreaming ? false : true);
                  setIsUserScrolling(false);
                }}
              >
                <ArrowDown weight="bold" className="text-white/60 w-5 h-5" />
              </div>
            </div>
          </div>
        )}
      </ThoughtExpansionProvider>
    </MessageActionsProvider>
  );
});

/**
 * Builds the history of messages for the chat.
 * This is mostly useful for rendering the history in a way that is easy to understand.
 * as well as compensating for agent thinking and other messages that are not part of the history, but
 * are still part of the chat.
 *
 * @param {Object} param0 - The parameters for building the messages.
 * @param {Array} param0.history - The history of messages.
 * @param {Object} param0.workspace - The workspace object.
 * @param {Function} param0.regenerateAssistantMessage - The function to regenerate the assistant message.
 * @param {Function} param0.saveEditedMessage - The function to save the edited message.
 * @param {Function} param0.forkThread - The function to fork the thread.
 * @param {WebSocket} param0.websocket - The active websocket connection for agent communication.
 * @param {boolean} param0.readOnly - Whether message mutation actions are disabled.
 * @returns {Array} The compiled history of messages.
 */
function buildMessages({
  history,
  workspace,
  regenerateAssistantMessage,
  saveEditedMessage,
  forkThread,
  websocket,
  readOnly,
}) {
  const lastBotReplyIndex = history.findLastIndex(
    (message) => message.role === "assistant" && message.type !== "agentStatus"
  );
  const messages = history.reduce((acc, props, index) => {
    const isLastBotReply =
      index === lastBotReplyIndex && props.role === "assistant";

    // The execution rail is the single surface for live Agent activity. These
    // legacy lifecycle records remain in the stream for compatibility, but
    // rendering them would create a second "Agent working" box.
    if (["statusResponse", "agentStatus"].includes(props?.type)) {
      return acc;
    }

    if (props?.type === "agentExecution" && props.agentRunState) {
      acc.push(
        <AgentExecutionRail
          key={props.uuid || `agent-execution-${index}`}
          runId={props.agentRunId}
          runState={props.agentRunState}
          transport={websocket}
        />
      );
      return acc;
    }

    if (props.type === "modelRouteNotification") {
      const lastMsg = history[history.length - 1];
      const isLast =
        index === history.length - 1 ||
        (index === history.length - 2 &&
          (lastMsg?.animate || lastMsg?.pending));
      const isStreaming =
        isLast &&
        (index === history.length - 1 || lastMsg?.animate || lastMsg?.pending);
      acc.push(
        <ModelRouteNotification
          key={`route-${props.uuid}`}
          routedTo={props.routedTo}
          isStreaming={isStreaming}
        />
      );
      return acc;
    }

    if (props.type === "subagentRun" && props.subagentRun) {
      acc.push(
        <SubagentRun
          key={props.uuid || `subagent-${index}`}
          run={props.subagentRun}
          live={props.subagentRun.status === "running"}
        />
      );
      return acc;
    }

    if (props.type === "contextTrace" && props.contextTrace) {
      acc.push(
        <ContextTrace
          key={props.uuid || `context-trace-${index}`}
          trace={props.contextTrace}
        />
      );
      return acc;
    }

    if (props.type === "toolApprovalRequest") {
      acc.push(
        <ToolApprovalRequest
          key={`tool-approval-${props.requestId}`}
          requestId={props.requestId}
          skillName={props.skillName}
          payload={props.payload}
          description={props.description}
          timeoutMs={props.timeoutMs}
          allowRemember={props.allowRemember}
          websocket={websocket}
        />
      );
      return acc;
    }

    if (props.type === "clarifyingQuestion") {
      acc.push(
        <ClarifyingQuestionCard
          key={`clarify-${props.requestId}`}
          requestId={props.requestId}
          questions={props.questions}
          allowSkip={props.allowSkip}
          timeoutMs={props.timeoutMs}
          resolved={props.resolved}
          resolution={props.resolution}
          websocket={websocket}
        />
      );
      return acc;
    }

    if (props.type === "rechartVisualize" && !!props.content) {
      acc.push(<Chartable key={props.uuid} props={props} />);
    } else if (props.type === "fileDownloadCard" && !!props.content) {
      acc.push(<FileDownloadCard key={props.uuid} props={props} />);
    } else if (props.type === "scheduledJobCreated" && !!props.content) {
      acc.push(<ScheduledJobCreatedCard key={props.uuid} props={props} />);
    } else if (isLastBotReply && props.animate) {
      acc.push(
        <PromptReply
          key={`prompt-reply-${props.uuid || index}`}
          uuid={props.uuid}
          reply={props.content}
          pending={props.pending}
          sources={props.sources}
          error={props.error}
          closed={props.closed}
        />
      );
    } else {
      acc.push(
        <HistoricalMessage
          key={index}
          uuid={props.uuid}
          message={props.content}
          role={props.role}
          workspace={workspace}
          sources={props.sources}
          feedbackScore={props.feedbackScore}
          chatId={props.chatId}
          error={props.error}
          attachments={props.attachments}
          regenerateMessage={regenerateAssistantMessage}
          isLastMessage={isLastBotReply}
          saveEditedMessage={saveEditedMessage}
          forkThread={forkThread}
          metrics={props.metrics}
          outputs={props.outputs}
          clarifyingQuestions={props.clarifyingQuestions}
          agentTrace={props.agentTrace}
          subagentRuns={props.subagentRuns}
          contextTraces={props.contextTraces}
          agentRunId={props.agentRunId}
          readOnly={readOnly}
        />
      );
    }
    return acc;
  }, []);

  return messages;
}
