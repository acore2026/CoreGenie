import { useLayoutEffect, useRef } from "react";

const FOCUSABLE_ELEMENTS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function SettingsModalBackdrop({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className="settings-modal-backdrop"
      onClick={onDismiss}
    />
  );
}

export function useSettingsModal({
  anchorRef,
  onDismiss,
  labelledBy,
  anchorIsDialog = false,
  active = true,
}: {
  anchorRef: React.RefObject<HTMLElement>;
  onDismiss: () => void;
  labelledBy?: string;
  anchorIsDialog?: boolean;
  active?: boolean;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const anchor = anchorRef.current;
    const dialog = anchorIsDialog ? anchor : anchor?.parentElement;
    if (!dialog) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    const previousRole = dialog.getAttribute("role");
    const previousAriaModal = dialog.getAttribute("aria-modal");
    const previousLabelledBy = dialog.getAttribute("aria-labelledby");

    dialog.classList.add("settings-modal-route");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    if (labelledBy) dialog.setAttribute("aria-labelledby", labelledBy);
    document.body.style.overflow = "hidden";

    const focusCloseButton = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-settings-close]")?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const openDialogs = Array.from(
        document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      );
      if (openDialogs.at(-1) !== dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS)
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusCloseButton);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      dialog.classList.remove("settings-modal-route");

      if (previousRole === null) dialog.removeAttribute("role");
      else dialog.setAttribute("role", previousRole);
      if (previousAriaModal === null) dialog.removeAttribute("aria-modal");
      else dialog.setAttribute("aria-modal", previousAriaModal);
      if (previousLabelledBy === null)
        dialog.removeAttribute("aria-labelledby");
      else dialog.setAttribute("aria-labelledby", previousLabelledBy);

      previousFocusRef.current?.focus?.();
    };
  }, [active, anchorIsDialog, anchorRef, labelledBy, onDismiss]);
}
