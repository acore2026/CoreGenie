import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useId } from "react";
import AnnouncementMarkdown from "./Markdown";

export const buttonClass =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-theme-sidebar-border px-3 py-2 text-sm font-medium text-theme-text-primary transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";
export const primaryClass = `${buttonClass} bg-primary-button !text-white hover:opacity-90`;
export const inputClass =
  "w-full rounded-lg border border-theme-sidebar-border bg-theme-settings-input-bg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button disabled:opacity-50";

export default function AnnouncementModal({
  title,
  onClose,
  busy = false,
  children,
  footer,
}) {
  const ref = useRef(null);
  const titleId = useId();
  const { t } = useTranslation();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
      className="announcement-dialog m-auto max-h-[85dvh] w-[calc(100%-32px)] max-w-2xl overflow-hidden rounded-2xl border border-theme-sidebar-border bg-theme-bg-secondary p-0 text-theme-text-primary backdrop:bg-black/55"
    >
      <div className="flex max-h-[85dvh] w-full flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-theme-sidebar-border px-5 py-4">
          <h2
            id={titleId}
            className="min-w-0 break-words pt-2 text-lg font-semibold"
          >
            {title}
          </h2>
          <button
            type="button"
            className={`${buttonClass} shrink-0 !px-2.5`}
            aria-label={t("announcements.close")}
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-theme-sidebar-border px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </dialog>,
    document.body
  );
}

export function AnnouncementContent({ item }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="mb-5 text-xs text-theme-text-secondary">
        {t("announcements.publishedAt", { date: formatDate(item.startsAt) })}
      </p>
      <AnnouncementMarkdown content={item.content} />
    </>
  );
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
