import {
  useEffect,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import {
  ArrowUp,
  At,
  ChatCircleText,
  Command,
  Wrench,
} from "@phosphor-icons/react";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";
import {
  ATTACHMENTS_PROCESSED_EVENT,
  ATTACHMENTS_PROCESSING_EVENT,
} from "../DnDWrapper";

export type ExamplePromptItem = string | { label?: string; prompt?: string };

export function ExamplePromptShelf({
  prompts = [],
  onSelect,
}: {
  prompts?: ExamplePromptItem[];
  onSelect: (prompt: string) => void;
}) {
  const visiblePrompts = prompts
    .map((item) => {
      if (typeof item === "string") {
        const prompt = item.trim();
        return { label: prompt, prompt };
      }
      const prompt = String(item?.prompt || "").trim();
      const label = String(item?.label || prompt).trim();
      return { label, prompt };
    })
    .filter(({ label, prompt }) => Boolean(label && prompt))
    .slice(0, 6);
  if (!visiblePrompts.length) return null;

  return (
    <div
      className="flex w-full flex-wrap items-stretch gap-2 px-1 py-2"
      aria-label="Agent example inputs"
    >
      {visiblePrompts.map(({ label, prompt }, index) => (
        <button
          key={`${label}-${index}`}
          type="button"
          onClick={() => onSelect(prompt)}
          title={label}
          className="group inline-flex min-h-8 min-w-0 max-w-full items-start gap-1.5 rounded-md border border-theme-sidebar-border bg-transparent px-3 py-2 text-left text-xs text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary md:max-w-[620px]"
        >
          <ChatCircleText
            size={13}
            className="mt-px shrink-0 text-theme-text-secondary"
          />
          <span className="min-w-0 whitespace-normal break-words leading-4">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

export function AgentSessionButton({
  sendCommand,
  promptInput,
  textareaRef,
  visible = true,
}: {
  sendCommand: (payload: { text: string; writeMode?: string }) => void;
  promptInput: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  visible?: boolean;
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
        className="group relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none text-theme-text-secondary transition-colors hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
      >
        <At size={18} className="pointer-events-none shrink-0 text-current" />
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

export function ToolsButton({
  showTools,
  setShowTools,
  closeQuickCommands,
  textareaRef,
}: {
  showTools: boolean;
  setShowTools: (value: boolean) => void;
  closeQuickCommands: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
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
      className={`group flex h-7 cursor-pointer items-center justify-center gap-x-1.5 rounded-md border-none px-2 text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${
        showTools
          ? "bg-theme-sidebar-subitem-selected text-theme-text-primary"
          : ""
      }`}
    >
      <Wrench size={14} weight="bold" className="shrink-0" />
      <span className="whitespace-nowrap text-xs font-medium">
        {t("chat_window.tools")}
      </span>
    </button>
  );
}

export function QuickCommandsButton({
  showing,
  setShowing,
  closeTools,
  textareaRef,
  autoOpenedRef,
}: {
  showing: boolean;
  setShowing: (value: boolean) => void;
  closeTools: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  autoOpenedRef: MutableRefObject<boolean>;
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
      className={`group flex h-7 cursor-pointer items-center justify-center gap-x-1.5 rounded-md border-none px-2 text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${
        showing
          ? "bg-theme-sidebar-subitem-selected text-theme-text-primary"
          : ""
      }`}
    >
      <Command size={14} weight="bold" className="shrink-0" />
      <span className="whitespace-nowrap text-xs font-medium">
        {t("chat_window.slash_commands")}
      </span>
    </button>
  );
}

export function SendPromptButton({
  formRef,
  promptInput,
  isDisabled,
}: {
  formRef: RefObject<HTMLButtonElement>;
  promptInput: string;
  isDisabled: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <button
        ref={formRef}
        type="submit"
        disabled={isDisabled || !promptInput.trim().length}
        className={`flex h-8 w-8 items-center justify-center rounded-md border-none transition-[background-color,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${
          promptInput.trim().length && !isDisabled
            ? "cursor-pointer bg-theme-text-primary text-theme-bg-chat hover:opacity-90"
            : "cursor-not-allowed bg-theme-sidebar-subitem-selected text-theme-text-secondary"
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
          className="pointer-events-none h-[18px] w-[18px] text-current"
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

export function useIsDisabled(): { isDisabled: boolean } {
  const [isDisabled, setIsDisabled] = useState(false);

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
