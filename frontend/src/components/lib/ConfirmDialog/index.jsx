import { useEffect, useId, useRef } from "react";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import ModalWrapper from "@/components/ModalWrapper";

export default function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    cancelRef.current?.focus();
    return () => previousFocus.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...(dialogRef.current?.querySelectorAll(
          'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) || []),
      ];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [busy, onCancel, open]);

  return (
    <ModalWrapper isOpen={open}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="dsh-dialog z-[1000] w-[min(420px,calc(100vw-32px))] p-5"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-300 light:text-red-700">
            <Warning size={18} weight="bold" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-base font-semibold">
              {title}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-sm leading-6 text-theme-text-secondary"
            >
              {description}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="dsh-control h-9 px-4 text-sm font-medium hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
            className="flex h-9 min-w-20 items-center justify-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 disabled:cursor-wait disabled:opacity-60 light:text-red-700"
          >
            {busy && <CircleNotch size={15} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}
