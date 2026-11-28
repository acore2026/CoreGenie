import { ABORT_STREAM_EVENT } from "@/utils/chat";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";

export default function StopGenerationButton() {
  const { t } = useTranslation();
  function emitHaltEvent() {
    window.dispatchEvent(new CustomEvent(ABORT_STREAM_EVENT));
  }

  return (
    <>
      <button
        type="button"
        onClick={emitHaltEvent}
        data-tooltip-id="stop-generation-button"
        data-tooltip-content={t("chat_window.stop_generating")}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-none bg-theme-text-primary text-theme-bg-chat transition-[background-color,opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
        aria-label={t("chat_window.stop_generating")}
      >
        <div className="h-3.5 w-3.5 rounded-sm bg-current" />
      </button>
      <Tooltip
        id="stop-generation-button"
        place="bottom"
        delayShow={300}
        className="tooltip !text-xs z-99"
      />
    </>
  );
}
