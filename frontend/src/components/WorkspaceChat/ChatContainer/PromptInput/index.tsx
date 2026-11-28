import {
  memo,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import debounce from "lodash.debounce";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import StopGenerationButton from "./StopGenerationButton";
import AttachmentManager from "./Attachments";
import AttachItem from "./AttachItem";
import {
  useDndUploader,
  type Attachment,
  PASTE_ATTACHMENT_EVENT,
} from "../DnDWrapper";
import useTextSize from "@/hooks/useTextSize";
import Appearance from "@/models/appearance";
import usePromptInputStorage from "@/hooks/usePromptInputStorage";
import ToolsMenu, { TOOLS_MENU_KEYBOARD_EVENT } from "./ToolsMenu";
import QuickCommandsMenu from "./QuickCommandsMenu";
import WorkspaceModelPicker from "../WorkspaceModelPicker";
import { useIsAgentSessionActive } from "@/utils/chat/agent";
import AgentSwitcher from "@/components/PredefinedAgents/AgentSwitcher";
import AgentWizard from "@/components/PredefinedAgents/AgentWizard";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import useUser from "@/hooks/useUser";
import {
  WORKSPACE_UPLOAD_COMPLETE,
  appendWorkspacePaths,
} from "@/utils/workspaceUpload";
import {
  AgentSessionButton,
  ExamplePromptShelf,
  QuickCommandsButton,
  SendPromptButton,
  ToolsButton,
  useIsDisabled,
  type ExamplePromptItem,
} from "./PromptToolbarButtons";

export const PROMPT_INPUT_ID = "primary-prompt-input";
export const PROMPT_INPUT_EVENT = "set_prompt_input";
const MAX_EDIT_STACK_SIZE = 100;

interface EditState {
  value: string;
  cursorPositionStart: number;
  cursorPositionEnd: number;
}

interface PromptInputProps {
  workspace?: {
    slug?: string;
    showAgentCommand?: boolean;
    [key: string]: unknown;
  };
  submit: (event: FormEvent | KeyboardEvent) => void;
  isStreaming: boolean;
  sendCommand: (payload: { text: string; writeMode?: string }) => void;
  attachments?: Attachment[];
  centered?: boolean;
  workspaceSlug?: string | null;
  threadSlug?: string | null;
  examplePrompts?: ExamplePromptItem[];
  agentSessionActive?: boolean;
}

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
  agentSessionActive: scopedAgentSessionActive,
}: PromptInputProps) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { selectedAgent } = usePredefinedAgent();
  const { showAgentCommand = true } = workspace ?? {};
  const { isDisabled: attachmentsDisabled } = useIsDisabled();
  const { uploading = 0 } = useDndUploader();
  const isDisabled = attachmentsDisabled || uploading > 0;
  const globalAgentSessionActive = useIsAgentSessionActive();
  const agentSessionActive =
    scopedAgentSessionActive ?? globalAgentSessionActive;
  const [promptInput, setPromptInput] = useState("");
  useEffect(() => {
    const appendUploads = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          slug?: string;
          threadSlug?: string | null;
          paths?: string[];
        }>
      ).detail;
      if (
        !detail ||
        detail.slug !== (workspaceSlug || workspace?.slug) ||
        (detail.threadSlug || null) !== (threadSlug || null)
      )
        return;
      setPromptInput((current) =>
        appendWorkspacePaths(current, detail.paths || [])
      );
    };
    window.addEventListener(WORKSPACE_UPLOAD_COMPLETE, appendUploads);
    return () =>
      window.removeEventListener(WORKSPACE_UPLOAD_COMPLETE, appendUploads);
  }, [workspaceSlug, workspace?.slug, threadSlug]);

  const [showTools, setShowTools] = useState(false);
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  const autoOpenedQuickCommandsRef = useRef(false);
  const toolsHighlightRef = useRef(-1);
  const quickCommandsHighlightRef = useRef(-1);
  const formRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [, setFocused] = useState(false);
  const undoStack = useRef<EditState[]>([]);
  const redoStack = useRef<EditState[]>([]);
  const { textSizeClass } = useTextSize();
  const [searchParams] = useSearchParams();

  usePromptInputStorage({
    promptInput,
    setPromptInput,
    storageKey: threadSlug ?? workspaceSlug ?? workspace?.slug,
  });

  useEffect(() => {
    if (searchParams.get("action") === "set-agent-chat") {
      sendCommand({ text: "@agent " });
      textareaRef.current?.focus();
    }
  }, [textareaRef.current]);

  function handlePromptUpdate(e: Event) {
    const { messageContent, writeMode = "replace" } =
      (
        e as CustomEvent<{
          messageContent?: string;
          writeMode?: "replace" | "append" | "prepend";
        }>
      )?.detail ?? {};
    if (writeMode === "append")
      setPromptInput((prev) => prev + (messageContent ?? ""));
    else if (writeMode === "prepend")
      setPromptInput((prev) => `${messageContent ?? ""} ${prev}`);
    else setPromptInput(messageContent ?? "");
  }

  useEffect(() => {
    if (typeof window !== "undefined")
      window.addEventListener(PROMPT_INPUT_EVENT, handlePromptUpdate);
    return () =>
      window?.removeEventListener(PROMPT_INPUT_EVENT, handlePromptUpdate);
  }, []);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) textareaRef.current.focus();
    resetTextAreaHeight();
  }, [isStreaming]);

  function saveCurrentState(adjustment = 0) {
    if (!textareaRef.current) return;
    if (undoStack.current.length >= MAX_EDIT_STACK_SIZE)
      undoStack.current.shift();
    undoStack.current.push({
      value: promptInput,
      cursorPositionStart: textareaRef.current.selectionStart + adjustment,
      cursorPositionEnd: textareaRef.current.selectionEnd + adjustment,
    });
  }
  const debouncedSaveState = debounce(saveCurrentState, 250);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
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

  function captureEnterOrUndo(event: KeyboardEvent<HTMLTextAreaElement>) {
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

    if (event.keyCode === 13 && !event.shiftKey) {
      event.preventDefault();
      if (isStreaming || isDisabled) return;
      setShowTools(false);
      setShowQuickCommands(false);
      submit(event);
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "z" &&
      event.shiftKey
    ) {
      event.preventDefault();
      if (redoStack.current.length === 0 || !textareaRef.current) return;

      const nextState = redoStack.current.pop();
      if (!nextState) return;

      undoStack.current.push({
        value: promptInput,
        cursorPositionStart: textareaRef.current.selectionStart,
        cursorPositionEnd: textareaRef.current.selectionEnd,
      });
      setPromptInput(nextState.value);
      setTimeout(() => {
        textareaRef.current?.setSelectionRange(
          nextState.cursorPositionStart,
          nextState.cursorPositionEnd
        );
      }, 0);
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "z" &&
      !event.shiftKey
    ) {
      if (undoStack.current.length === 0 || !textareaRef.current) return;
      const lastState = undoStack.current.pop();
      if (!lastState) return;

      redoStack.current.push({
        value: promptInput,
        cursorPositionStart: textareaRef.current.selectionStart,
        cursorPositionEnd: textareaRef.current.selectionEnd,
      });
      setPromptInput(lastState.value);
      setTimeout(() => {
        textareaRef.current?.setSelectionRange(
          lastState.cursorPositionStart,
          lastState.cursorPositionEnd
        );
      }, 0);
    }
  }

  function adjustTextArea(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  function handlePasteEvent(e: ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    if (e.clipboardData.items.length === 0) return;

    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/") || item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          window.dispatchEvent(
            new CustomEvent(PASTE_ATTACHMENT_EVENT, {
              detail: { files: [file] },
            })
          );
        }
        continue;
      }
    }

    const pasteText = e.clipboardData.getData("text/plain");
    if (pasteText && textareaRef.current) {
      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newPromptInput =
        promptInput.substring(0, start) +
        pasteText +
        promptInput.substring(end);
      setPromptInput(newPromptInput);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + pasteText.length;
        adjustTextArea(textarea);
      }, 0);
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    debouncedSaveState(-1);
    adjustTextArea(e.target);
    const value = e.target.value;
    setPromptInput(value);

    if (
      autoOpenedQuickCommandsRef.current &&
      showQuickCommands &&
      value !== "/"
    ) {
      setShowQuickCommands(false);
      autoOpenedQuickCommandsRef.current = false;
    }
  }

  function selectExamplePrompt(prompt: string) {
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
            : "flex flex-col gap-y-1 rounded-t-lg md:w-full w-full mx-auto max-w-[920px] px-3 md:px-0 items-center"
        }
      >
        <div
          className={`flex w-full items-center rounded-lg ${centered ? "mb-0" : "mb-4"}`}
        >
          <div className="relative w-full min-w-0">
            <ToolsMenu
              workspace={workspace}
              agentSessionActive={agentSessionActive}
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
            {centered &&
              Boolean(
                (selectedAgent as { wizard?: unknown } | null)?.wizard
              ) && (
                <AgentWizard
                  key={`${selectedAgent?.id}:${workspaceSlug}:${threadSlug}`}
                  agent={selectedAgent}
                  disabled={isDisabled || isStreaming || agentSessionActive}
                  onUse={(prompt: string) =>
                    selectExamplePrompt(
                      promptInput.trim()
                        ? `${promptInput}\n\n${prompt}`
                        : prompt
                    )
                  }
                />
              )}
            <div className="flex flex-col overflow-visible rounded-lg border border-theme-chat-input-border bg-theme-bg-chat-input px-4 transition-[border-color,box-shadow] duration-150 focus-within:ring-1 focus-within:ring-theme-button-primary">
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
                    adjustTextArea(e.target);
                  }}
                  value={promptInput}
                  spellCheck={Boolean(Appearance.get("enableSpellCheck"))}
                  className={`border-none cursor-text max-h-[50vh] md:max-h-[350px] md:min-h-[40px] pt-4 w-full leading-5 text-theme-text-primary bg-transparent placeholder:text-theme-text-placeholder resize-none active:outline-none focus:outline-none flex-grow pwa:!text-[16px] ${textSizeClass}`}
                  placeholder={t("chat_window.send_message")}
                />
              </div>
              <div className="flex items-center justify-between gap-2 pb-2.5 pt-2">
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
                      visible={!agentSessionActive && showAgentCommand}
                    />
                  </div>
                  <QuickCommandsButton
                    showing={showQuickCommands}
                    setShowing={setShowQuickCommands}
                    closeTools={() => setShowTools(false)}
                    textareaRef={textareaRef}
                    autoOpenedRef={autoOpenedQuickCommandsRef}
                  />
                  {(!Object.prototype.hasOwnProperty.call(user || {}, "role") ||
                    user?.role === "admin") && (
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
            {centered && (
              <ExamplePromptShelf
                prompts={examplePrompts}
                onSelect={selectExamplePrompt}
              />
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export default memo(PromptInput);
