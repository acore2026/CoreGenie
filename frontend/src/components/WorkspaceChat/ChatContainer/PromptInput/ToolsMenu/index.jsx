import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "@phosphor-icons/react";
import AgentSkillsTab from "./Tabs/AgentSkills";

export const TOOLS_MENU_KEYBOARD_EVENT = "tools-menu-keyboard";

/**
 * @param {Workspace} props.workspace - the workspace object
 * @param {boolean} props.showing
 * @param {function} props.setShowing
 * @param {function} props.sendCommand
 * @param {object} props.promptRef
 * @param {boolean} [props.centered] - when true, popup opens below the input
 */
export default function ToolsMenu({
  workspace,
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

  // Reset highlight when opening or closing.
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [showing]);

  // Constrain popover height to the space available in the viewport so it
  // never overflows off-screen on shorter windows (e.g. centered home view).
  useLayoutEffect(() => {
    if (!showing) return;
    const update = () => {
      const el = popoverRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const available = centered
        ? window.innerHeight - rect.top - 16
        : rect.bottom - 16;
      setMaxHeight(Math.max(0, Math.min(360, available)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [showing, centered]);

  // Keep the parent ref in sync so PromptInput can check it on Enter
  useEffect(() => {
    if (highlightedIndexRef) highlightedIndexRef.current = highlightedIndex;
  }, [highlightedIndex]);

  const registerItemCount = useCallback((count) => {
    itemCountRef.current = count;
  }, []);

  useEffect(() => {
    if (!showing) return;

    function handleKeyboard(e) {
      const { key } = e.detail;

      if (key === "ArrowUp" || key === "ArrowDown") {
        const count = itemCountRef.current;
        if (count === 0) return;
        setHighlightedIndex((prev) => {
          if (key === "ArrowDown") {
            return prev < count - 1 ? prev + 1 : 0;
          }
          return prev > 0 ? prev - 1 : count - 1;
        });
        return;
      }

      // Enter is handled by the tab components via highlightedIndex
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
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShowing(false)}
      />
      <div
        ref={popoverRef}
        onMouseDown={(e) => {
          // Prevents prompt textarea from losing focus when clicking inside the menu.
          // Skip for portaled modals so their inputs can still receive focus.
          if (e.currentTarget.contains(e.target)) e.preventDefault();
        }}
        style={{ maxHeight }}
        className={`absolute left-2 right-2 md:left-14 md:right-auto md:w-[400px] z-50 bg-zinc-800 light:bg-white border border-zinc-700 light:border-slate-300 rounded-lg p-3 flex flex-col gap-2.5 shadow-lg overflow-hidden ${
          centered ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        <div className="flex shrink-0 items-center gap-2 px-1 pb-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300 light:bg-cyan-600/10 light:text-cyan-700">
            <Wrench size={15} weight="duotone" />
          </span>
          <p className="text-xs font-semibold text-white light:text-slate-900">
            {t("chat_window.agent_skills")}
          </p>
        </div>

        <div className="flex flex-col gap-1 overflow-y-auto no-scroll min-h-0">
          <AgentSkillsTab
            sendCommand={sendCommand}
            setShowing={setShowing}
            promptRef={promptRef}
            highlightedIndex={highlightedIndex}
            registerItemCount={registerItemCount}
            workspace={workspace}
          />
        </div>
      </div>
    </>
  );
}
