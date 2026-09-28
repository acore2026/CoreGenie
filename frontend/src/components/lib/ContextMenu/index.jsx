import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_GAP = 8;

export default function ContextMenu({
  point,
  label,
  onClose,
  children,
  width = 190,
}) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState(point);

  useLayoutEffect(() => {
    if (!point || !menuRef.current) return;
    const bounds = menuRef.current.getBoundingClientRect();
    setPosition({
      x: Math.max(
        VIEWPORT_GAP,
        Math.min(point.x, window.innerWidth - bounds.width - VIEWPORT_GAP)
      ),
      y: Math.max(
        VIEWPORT_GAP,
        Math.min(point.y, window.innerHeight - bounds.height - VIEWPORT_GAP)
      ),
    });
  }, [point]);

  useEffect(() => {
    if (!point) return;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const closeOnPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) onClose();
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    const closeOnViewportChange = () => onClose();
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("blur", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("blur", closeOnViewportChange);
    };
  }, [onClose, point]);

  if (!point) return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="dsh-menu fixed z-[1000]"
      style={{
        left: position?.x ?? point.x,
        top: position?.y ?? point.y,
        width,
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const items = [
          ...event.currentTarget.querySelectorAll(
            '[role="menuitem"]:not(:disabled)'
          ),
        ];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next]?.focus();
      }}
    >
      {children}
    </div>,
    document.body
  );
}
