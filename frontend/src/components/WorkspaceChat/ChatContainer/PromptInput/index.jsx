import { memo, useState, useRef, useEffect } from "react";
import debounce from "lodash.debounce";
import {
  ArrowUp,
  At,
  ChatCircleText,
  Command,
  Wrench,
} from "@phosphor-icons/react";
import StopGenerationButton from "./StopGenerationButton";
import SpeechToText from "./SpeechToText";
import { Tooltip } from "react-tooltip";
import AttachmentManager from "./Attachments";
import AttachItem from "./AttachItem";
import {
  ATTACHMENTS_PROCESSED_EVENT,
  ATTACHMENTS_PROCESSING_EVENT,
  PASTE_ATTACHMENT_EVENT,
} from "../DnDWrapper";
import useTextSize from "@/hooks/useTextSize";
import { useTranslation } from "react-i18next";
import Appearance from "@/models/appearance";
import usePromptInputStorage from "@/hooks/usePromptInputStorage";
import ToolsMenu, { TOOLS_MENU_KEYBOARD_EVENT } from "./ToolsMenu";
import QuickCommandsMenu from "./QuickCommandsMenu";
import ToolApprovalMode from "./ToolApprovalMode";
import WorkspaceModelPicker from "../WorkspaceModelPicker";
import { useSearchParams } from "react-router-dom";
import { useIsAgentSessionActive } from "@/utils/chat/agent";
import AgentSwitcher from "@/components/PredefinedAgents/AgentSwitcher";
import useUser from "@/hooks/useUser";

export const PROMPT_INPUT_ID = "primary-prompt-input";
export const PROMPT_INPUT_EVENT = "set_prompt_input";
const MAX_EDIT_STACK_SIZE = 100;

/**
 * @param {Workspace} props.workspace - workspace object
 * @param {function} props.submit - form submit handler
 * @param {boolean} props.isStreaming - disables input while streaming response
 * @param {function} props.sendCommand - handler for slash commands and agent mentions
 * @param {Array} [props.attachments] - file attachments array
 * @param {boolean} [props.centered] - renders in centered layout mode (for home page)
 * @param {string} [props.workspaceSlug] - workspace slug for home page context
 * @param {string} [props.threadSlug] - thread slug for home page context
 * @param {string[]} [props.examplePrompts] - selected Agent example inputs
 */
function PromptInput({
  workspace = {},
  submit,
  isStreaming,
  sendCommand,
  attachments = [],
  centered = false,
  workspaceSlug = null,
  threadSlug = null,
  examplePrompts = [],
}) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { showAgentCommand = true } = workspace ?? {};
  const { isDisabled } = useIsDisabled();
  const agentSessionActive = useIsAgentSessionActive();
  const [promptInput, setPromptInput] = useState("");
  const [showTools, setShowTools] = useState(false);
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  const autoOpenedQuickCommandsRef = useRef(false);
  const toolsHighlightRef = useRef(-1);
  const quickCommandsHighlightRef = useRef(-1);
  const formRef = useRef(null);
  const textareaRef = useRef(null);
  const [_, setFocused] = useState(false);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const { textSizeClass } = useTextSize();
  const [searchParams] = useSearchParams();

  // Synchronizes prompt input value with localStorage, scoped to the current thread.
  usePromptInputStorage({
    promptInput,
    setPromptInput,
  });

  /*
   * @checklist-item
   * If the URL has the agent param, open the agent menu for the user
   * automatically when the component mounts.
   */
  useEffect(() => {
    if (searchParams.get("action") === "set-agent-chat") {
      sendCommand({ text: "@agent " });
      textareaRef.current?.focus();
    }
  }, [textareaRef.current]);

  /**
   * To prevent too many re-renders we remotely listen for updates from the parent
   * via an event cycle. Otherwise, using message as a prop leads to a re-render every
   * change on the input.
   * @param {{detail: {messageContent: string, writeMode: 'replace' | 'append'}}} e
   */
  function handlePromptUpdate(e) {
    const { messageContent, writeMode = "replace" } = e?.detail ?? {};
    if (writeMode === "append") setPromptInput((prev) => prev + messageContent);
    else if (writeMode === "prepend")
      setPromptInput((prev) => messageContent + " " + prev);
    else setPromptInput(messageContent ?? "");
  }

  useEffect(() => {
    if (!!window)
      window.addEventListener(PROMPT_INPUT_EVENT, handlePromptUpdate);
    return () =>
      window?.removeEventListener(PROMPT_INPUT_EVENT, handlePromptUpdate);
  }, []);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) textareaRef.current.focus();
    resetTextAreaHeight();
  }, [isStreaming]);

  /**
   * Save the current state before changes
   * @param {number} adjustment
   */
  function saveCurrentState(adjustment = 0) {
    if (undoStack.current.length >= MAX_EDIT_STACK_SIZE)
      undoStack.current.shift();
    undoStack.current.push({
      value: promptInput,
      cursorPositionStart: textareaRef.current.selectionStart + adjustment,
      cursorPositionEnd: textareaRef.current.selectionEnd + adjustment,
    });
  }
  const debouncedSaveState = debounce(saveCurrentState, 250);

  function handleSubmit(e) {
    // Ignore submits from portaled modals (slash command preset forms)
    if (e.target !== e.currentTarget) return;
    setFocused(false);
    setShowTools(false);
    setShowQuickCommands(false);
    submit(e);
  }

  function resetTextAreaHeight() {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
  }

  /**
   * Capture enter key press to handle submission, redo, or undo
   * via keyboard shortcuts
   * @param {KeyboardEvent} event
   */
  function captureEnterOrUndo(event) {
    // Forward keyboard events to the active command/tool menu.
    if (showTools || showQuickCommands) {
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(TOOLS_MENU_KEYBOARD_EVENT, {
            detail: { key: event.key },
          })
        );
        return;
      }
      // When an item is highlighted via arrow keys, Enter selects it.
      // Otherwise, Enter falls through to submit the form normally.
      const highlightedIndex = showTools
        ? toolsHighlightRef.current
        : quickCommandsHighlightRef.current;
      if (event.key === "Enter" && highlightedIndex >= 0) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(TOOLS_MENU_KEYBOARD_EVENT, {
            detail: { key: "Enter" },
          })
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setShowTools(false);
        setShowQuickCommands(false);
        textareaRef.current?.focus();
        return;
      }
    }

    // "/" opens Quick Commands when the input is empty.
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      promptInput.trim() === ""
    ) {
      setShowTools(false);
      setShowQuickCommands((prev) => {
        autoOpenedQuickCommandsRef.current = !prev;
        return !prev;
      });
      return;
    }

    // Is simple enter key press w/o shift key
    if (event.keyCode === 13 && !event.shiftKey) {
      event.preventDefault();
      if (isStreaming || isDisabled) return; // Prevent submission if streaming or disabled
      setShowTools(false);
      setShowQuickCommands(false);
      return submit(event);
    }

    // Is undo with Ctrl+Z or Cmd+Z + Shift key = Redo
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "z" &&
      event.shiftKey
    ) {
      event.preventDefault();
      if (redoStack.current.length === 0) return;

      const nextState = redoStack.current.pop();
      if (!nextState) return;

      undoStack.current.push({
        value: promptInput,
        cursorPositionStart: textareaRef.current.selectionStart,
        cursorPositionEnd: textareaRef.current.selectionEnd,
      });
      setPromptInput(nextState.value);
      setTimeout(() => {
        textareaRef.current.setSelectionRange(
          nextState.cursorPositionStart,
          nextState.cursorPositionEnd
        );
      }, 0);
    }

    // Undo with Ctrl+Z or Cmd+Z
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "z" &&
      !event.shiftKey
    ) {
      if (undoStack.current.length === 0) return;
      const lastState = undoStack.current.pop();
      if (!lastState) return;

      redoStack.current.push({
        value: promptInput,
        cursorPositionStart: textareaRef.current.selectionStart,
        cursorPositionEnd: textareaRef.current.selectionEnd,
      });
      setPromptInput(lastState.value);
      setTimeout(() => {
        textareaRef.current.setSelectionRange(
          lastState.cursorPositionStart,
          lastState.cursorPositionEnd
        );
      }, 0);
    }
  }

  function adjustTextArea(event) {
    const element = event.target;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  function handlePasteEvent(e) {
    e.preventDefault();
    if (e.clipboardData.items.length === 0) return false;

    // paste any clipboard items that are images.
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        window.dispatchEvent(
          new CustomEvent(PASTE_ATTACHMENT_EVENT, {
            detail: { files: [file] },
          })
        );
        continue;
      }

      // handle files specifically that are not images as uploads
      if (item.kind === "file") {
        const file = item.getAsFile();
        window.dispatchEvent(
          new CustomEvent(PASTE_ATTACHMENT_EVENT, {
            detail: { files: [file] },
          })
        );
        continue;
      }
    }

    const pasteText = e.clipboardData.getData("text/plain");
    if (pasteText) {
      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newPromptInput =
        promptInput.substring(0, start) +
        pasteText +
        promptInput.substring(end);
      setPromptInput(newPromptInput);

      // Set the cursor position after the pasted text
      // we need to use setTimeout to prevent the cursor from being set to the end of the text
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + pasteText.length;
        adjustTextArea({ target: textarea });
      }, 0);
    }
    return;
  }

  function handleChange(e) {
    debouncedSaveState(-1);
    adjustTextArea(e);
    const value = e.target.value;
    setPromptInput(value);

    // Auto-dismiss Quick Commands after the opening slash is modified.
    if (
      autoOpenedQuickCommandsRef.current &&
      showQuickCommands &&
      value !== "/"
    ) {
      setShowQuickCommands(false);
      autoOpenedQuickCommandsRef.current = false;
    }
  }

  function selectExamplePrompt(prompt) {
    saveCurrentState();
    setPromptInput(prompt);
    setShowTools(false);
    setShowQuickCommands(false);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.setSelectionRange(prompt.length, prompt.length);
    });
  }

  return (
    <div
      id="prompt-input-wrapper"
      className={
        centered
          ? "w-full relative flex justify-center items-center"
          : "w-full fixed md:absolute bottom-0 left-0 z-10 flex justify-center items-center pwa:pb-5"
      }
    >
      <form
        onSubmit={handleSubmit}
        className={
          centered
            ? "flex flex-col gap-y-1 rounded-t-lg w-full items-center"
            : "flex flex-col gap-y-1 rounded-t-lg md:w-full w-full mx-auto max-w-[750px] items-center"
        }
      >
        <div
          className={`flex items-center rounded-lg md:w-full ${centered ? "mb-0" : "mb-4"}`}
        >
          <div className="relative w-[95vw] md:w-[750px]">
            <ToolsMenu
              workspace={workspace}
              showing={showTools}
              setShowing={setShowTools}
              sendCommand={sendCommand}
              promptRef={textareaRef}
              centered={centered}
              highlightedIndexRef={toolsHighlightRef}
            />
            <QuickCommandsMenu
              showing={showQuickCommands}
              setShowing={setShowQuickCommands}
              sendCommand={sendCommand}
              promptRef={textareaRef}
              centered={centered}
              highlightedIndexRef={quickCommandsHighlightRef}
            />
            <ExamplePromptShelf
              prompts={examplePrompts}
              onSelect={selectExamplePrompt}
            />
            <div className="bg-theme-bg-chat-input border border-theme-chat-input-border rounded-[20px] pwa:rounded-3xl flex flex-col px-5 overflow-hidden">
              <AttachmentManager attachments={attachments} />
              <div className="flex items-center">
                <textarea
                  id={PROMPT_INPUT_ID}
                  ref={textareaRef}
                  onChange={handleChange}
                  onKeyDown={captureEnterOrUndo}
                  onPaste={(e) => {
                    saveCurrentState();
                    handlePasteEvent(e);
                  }}
                  required={true}
                  onFocus={() => setFocused(true)}
                  onBlur={(e) => {
                    setFocused(false);
                    adjustTextArea(e);
                  }}
                  value={promptInput}
                  spellCheck={Appearance.get("enableSpellCheck")}
                  className={`border-none cursor-text max-h-[50vh] md:max-h-[350px] md:min-h-[40px] pt-[20px] w-full leading-5 text-theme-text-primary bg-transparent placeholder:text-theme-text-placeholder resize-none active:outline-none focus:outline-none flex-grow pwa:!text-[16px] ${textSizeClass}`}
                  placeholder={t("chat_window.send_message")}
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-3.5 pb-3">
                <div className="flex min-w-0 items-center gap-x-0.5">
                  <div className="flex items-center gap-x-1">
                    <AttachItem
                      workspaceSlug={workspaceSlug}
                      workspaceThreadSlug={threadSlug}
                    />
                    <AgentSessionButton
                      sendCommand={sendCommand}
                      promptInput={promptInput}
                      textareaRef={textareaRef}
                      visible={!agentSessionActive & showAgentCommand}
                    />
                  </div>
                  <QuickCommandsButton
                    showing={showQuickCommands}
                    setShowing={setShowQuickCommands}
                    closeTools={() => setShowTools(false)}
                    textareaRef={textareaRef}
                    autoOpenedRef={autoOpenedQuickCommandsRef}
                  />
                  {(!user?.hasOwnProperty("role") || user.role === "admin") && (
                    <ToolsButton
                      showTools={showTools}
                      setShowTools={setShowTools}
                      closeQuickCommands={() => setShowQuickCommands(false)}
                      textareaRef={textareaRef}
                    />
                  )}
                  <AgentSwitcher disabled={agentSessionActive} />
                </div>
                <div className="flex min-w-0 items-center justify-end gap-x-1 md:gap-x-1.5">
                  <WorkspaceModelPicker
                    workspaceSlug={workspaceSlug ?? workspace?.slug}
                  />
                  <ToolApprovalMode />
                  <SpeechToText sendCommand={sendCommand} />
                  {isStreaming || agentSessionActive ? (
                    <StopGenerationButton />
                  ) : (
                    <SendPromptButton
                      formRef={formRef}
                      promptInput={promptInput}
                      isDisabled={isDisabled}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function ExamplePromptShelf({ prompts = [], onSelect }) {
  const visiblePrompts = prompts
    .map((prompt) => String(prompt || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!visiblePrompts.length) return null;

  return (
    <div
      className="flex w-full items-center gap-2 overflow-x-auto px-1 py-2 no-scroll"
      aria-label="Agent example inputs"
    >
      {visiblePrompts.map((prompt, index) => (
        <button
          key={`${prompt}-${index}`}
          type="button"
          onClick={() => onSelect(prompt)}
          title={prompt}
          className="group inline-flex min-h-8 w-fit max-w-[calc(100%_-_8px)] shrink-0 items-start gap-1.5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.055] px-3 py-2 text-left text-xs text-zinc-300 shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-cyan-300/[0.1] hover:text-white md:max-w-[620px] light:border-cyan-600/15 light:bg-cyan-50 light:text-slate-600 light:hover:border-cyan-500/40 light:hover:bg-cyan-100 light:hover:text-slate-900"
        >
          <ChatCircleText
            size={13}
            weight="duotone"
            className="mt-px shrink-0 text-cyan-300 light:text-cyan-700"
          />
          <span className="whitespace-normal break-words leading-4">
            {prompt}
          </span>
        </button>
      ))}
    </div>
  );
}

function AgentSessionButton({
  sendCommand,
  promptInput,
  textareaRef,
  visible = true,
}) {
  const { t } = useTranslation();
  if (!visible) return null;

  function handleClick() {
    try {
      if (promptInput?.trim()?.startsWith("@agent")) return;
      sendCommand({ text: "@agent", writeMode: "prepend" });
    } finally {
      textareaRef?.current?.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        data-tooltip-id="agent-session"
        data-tooltip-content={t("chat_window.start_agent_session")}
        aria-label={t("chat_window.start_agent_session")}
        className="group border-none relative flex justify-center items-center cursor-pointer w-6 h-6 rounded-full hover:bg-zinc-700 light:hover:bg-slate-200"
      >
        <At
          size={18}
          className="pointer-events-none text-zinc-300 light:text-slate-600 group-hover:text-white light:group-hover:text-slate-600 shrink-0"
        />
      </button>
      <Tooltip
        id="agent-session"
        place="bottom"
        delayShow={300}
        className="tooltip !text-xs z-99"
      />
    </>
  );
}

function ToolsButton({
  showTools,
  setShowTools,
  closeQuickCommands,
  textareaRef,
}) {
  const { t } = useTranslation();

  return (
    <button
      id="tools-btn"
      type="button"
      onClick={() => {
        closeQuickCommands();
        setShowTools(!showTools);
        textareaRef.current?.focus();
      }}
      className={`group border-none cursor-pointer flex items-center justify-center gap-x-1.5 h-6 px-2 rounded-full transition-colors ${
        showTools
          ? "bg-zinc-700 text-white light:bg-slate-200 light:text-slate-800"
          : "text-zinc-300 hover:bg-zinc-700 hover:text-white light:text-slate-600 light:hover:bg-slate-200 light:hover:text-slate-800"
      }`}
    >
      <Wrench size={14} weight="bold" className="shrink-0" />
      <span className="whitespace-nowrap text-xs font-medium">
        {t("chat_window.tools")}
      </span>
    </button>
  );
}

function QuickCommandsButton({
  showing,
  setShowing,
  closeTools,
  textareaRef,
  autoOpenedRef,
}) {
  const { t } = useTranslation();

  return (
    <button
      id="quick-commands-btn"
      type="button"
      onClick={() => {
        autoOpenedRef.current = false;
        closeTools();
        setShowing(!showing);
        textareaRef.current?.focus();
      }}
      aria-label={t("chat_window.slash_commands")}
      className={`group flex h-6 cursor-pointer items-center justify-center gap-x-1.5 rounded-full border-none px-2 transition-colors ${
        showing
          ? "bg-violet-500/20 text-violet-200 light:bg-violet-100 light:text-violet-800"
          : "text-zinc-300 hover:bg-zinc-700 hover:text-white light:text-slate-600 light:hover:bg-slate-200 light:hover:text-slate-800"
      }`}
    >
      <Command size={14} weight="bold" className="shrink-0" />
      <span className="whitespace-nowrap text-xs font-medium">
        {t("chat_window.slash_commands")}
      </span>
    </button>
  );
}

function SendPromptButton({ formRef, promptInput, isDisabled }) {
  const { t } = useTranslation();

  return (
    <>
      <button
        ref={formRef}
        type="submit"
        disabled={isDisabled || !promptInput.trim().length}
        className={`border-none flex justify-center items-center rounded-full w-8 h-8 transition-all ${
          promptInput.trim().length && !isDisabled
            ? "cursor-pointer bg-white hover:bg-zinc-200 light:bg-slate-800 light:hover:bg-slate-600"
            : "cursor-not-allowed bg-zinc-600 light:bg-slate-400"
        }`}
        data-tooltip-id="send-prompt"
        data-tooltip-content={
          isDisabled
            ? t("chat_window.attachments_processing")
            : t("chat_window.send")
        }
        aria-label={t("chat_window.send")}
      >
        <ArrowUp
          className="w-[18px] h-[18px] pointer-events-none text-zinc-800 light:text-white"
          weight="bold"
        />
        <span className="sr-only">{t("chat_window.send")}</span>
      </button>
      <Tooltip
        id="send-prompt"
        place="bottom"
        delayShow={300}
        className="tooltip !text-xs z-99"
      />
    </>
  );
}

/**
 * Handle event listeners to prevent the send button from being used
 * for whatever reason that may we may want to prevent the user from sending a message.
 */
function useIsDisabled() {
  const [isDisabled, setIsDisabled] = useState(false);

  /**
   * Handle attachments processing and processed events
   * to prevent the send button from being clicked when attachments are processing
   * or else the query may not have relevant context since RAG is not yet ready.
   */
  useEffect(() => {
    if (!window) return;
    const onProcessing = () => setIsDisabled(true);
    const onProcessed = () => setIsDisabled(false);

    window.addEventListener(ATTACHMENTS_PROCESSING_EVENT, onProcessing);
    window.addEventListener(ATTACHMENTS_PROCESSED_EVENT, onProcessed);

    return () => {
      window.removeEventListener(ATTACHMENTS_PROCESSING_EVENT, onProcessing);
      window.removeEventListener(ATTACHMENTS_PROCESSED_EVENT, onProcessed);
    };
  }, []);

  return { isDisabled };
}

export default memo(PromptInput);
