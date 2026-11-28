import { useEffect } from "react";
import { TOOLS_MENU_KEYBOARD_EVENT } from "./";

/**
 * Shared hook for ToolsMenu tabs that registers the item count
 * for Up/Down navigation and handles Enter to select the highlighted item.
 * @param {Array} items - the list of items rendered in the tab
 * @param {number} highlightedIndex - currently highlighted index from parent
 * @param {function} onSelect - called with the highlighted item on Enter
 * @param {function} registerItemCount - callback to register total item count with parent
 */
export default function useToolsMenuItems<T>({
  items,
  highlightedIndex,
  onSelect,
  registerItemCount,
}: {
  items: T[];
  highlightedIndex: number;
  onSelect: (item: T) => void;
  registerItemCount?: (count: number) => void;
}) {
  useEffect(() => {
    registerItemCount?.(items.length);
  }, [items.length, registerItemCount]);

  useEffect(() => {
    if (highlightedIndex < 0 || highlightedIndex >= items.length) return;
    function handleEnter(e: WindowEventMap["tools-menu-keyboard"]) {
      if (e.detail.key !== "Enter") return;
      onSelect(items[highlightedIndex]);
    }
    window.addEventListener(TOOLS_MENU_KEYBOARD_EVENT, handleEnter);
    return () =>
      window.removeEventListener(TOOLS_MENU_KEYBOARD_EVENT, handleEnter);
  }, [highlightedIndex, items, onSelect]);
}
