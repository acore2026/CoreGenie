import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Command } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import SlashCommandsTab from "../ToolsMenu/Tabs/SlashCommands";
import { TOOLS_MENU_KEYBOARD_EVENT } from "../ToolsMenu";

export default function QuickCommandsMenu({
  showing,
  setShowing,
  sendCommand,
  promptRef,
  centered = false,
  highlightedIndexRef,
}) {
  const { t } = useTranslation();
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [maxHeight, setMaxHeight] = useState(360);
  const itemCountRef = useRef(0);
  const popoverRef = useRef(null);

  useEffect(() => setHighlightedIndex(-1), [showing]);

  useLayoutEffect(() => {
    if (!showing) return;
    const update = () => {
      const element = popoverRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const available = centered
        ? window.innerHeight - rect.top - 16
        : rect.bottom - 16;
      setMaxHeight(Math.max(0, Math.min(360, available)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [showing, centered]);

  useEffect(() => {
    if (highlightedIndexRef) highlightedIndexRef.current = highlightedIndex;
  }, [highlightedIndex, highlightedIndexRef]);

  const registerItemCount = useCallback((count) => {
    itemCountRef.current = count;
  }, []);

  useEffect(() => {
    if (!showing) return;
    function handleKeyboard(event) {
      const { key } = event.detail;
      if (key !== "ArrowUp" && key !== "ArrowDown") return;
      const count = itemCountRef.current;
      if (!count) return;
      setHighlightedIndex((current) => {
        if (key === "ArrowDown") return current < count - 1 ? current + 1 : 0;
        return current > 0 ? current - 1 : count - 1;
      });
    }
    window.addEventListener(TOOLS_MENU_KEYBOARD_EVENT, handleKeyboard);
    return () =>
      window.removeEventListener(TOOLS_MENU_KEYBOARD_EVENT, handleKeyboard);
  }, [showing]);

  if (!showing) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setShowing(false)}
      />
      <div
        ref={popoverRef}
        onMouseDown={(event) => {
          if (event.currentTarget.contains(event.target))
            event.preventDefault();
        }}
        style={{ maxHeight }}
        className={`absolute left-2 right-2 z-50 flex flex-col gap-2.5 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800 p-3 shadow-xl light:border-slate-300 light:bg-white md:left-14 md:right-auto md:w-[400px] ${
          centered ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        <div className="flex shrink-0 items-center gap-2 px-1 pb-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300 light:bg-violet-600/10 light:text-violet-700">
            <Command size={15} weight="bold" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white light:text-slate-900">
              {t("chat_window.slash_commands")}
            </p>
            <p className="truncate text-[10px] text-zinc-400 light:text-slate-500">
              {t("chat_window.quick_commands_global_hint")}
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto no-scroll">
          <SlashCommandsTab
            sendCommand={sendCommand}
            setShowing={setShowing}
            promptRef={promptRef}
            highlightedIndex={highlightedIndex}
            registerItemCount={registerItemCount}
          />
        </div>
      </div>
    </>
  );
}
