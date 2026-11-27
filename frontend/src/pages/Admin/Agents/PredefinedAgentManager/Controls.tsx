import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "@phosphor-icons/react";

export function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  onClose(): void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={box}
      onKeyDown={(event) => {
        // Native fullscreen editors use a portal and manage their own keys.
        if (!box.current?.contains(event.target as Node)) return;
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
        if (event.key !== "Tab") return;
        const items = [
          ...(box.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
          ) || []),
        ].filter((item) => item.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        className={`flex max-h-[92vh] w-full ${wide ? "max-w-6xl" : "max-w-3xl"} flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl light:border-slate-200 light:bg-white`}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-white/10 px-5 py-4 light:border-slate-200">
          <div>
            <h2
              id={titleId}
              className="text-base font-semibold text-white light:text-slate-900"
            >
              {title}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 light:text-slate-500">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("personal_skills.close")}
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white light:hover:bg-slate-100 light:hover:text-slate-900"
          >
            <X size={17} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint = null,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1.5 flex items-center gap-2 text-xs font-medium text-zinc-300 light:text-slate-700">
        {label}
        {hint && (
          <span className="font-normal text-zinc-600 light:text-slate-400">
            {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

export function CheckCard({
  checked,
  title,
  description,
  onClick,
}: {
  checked: boolean;
  title: string;
  description?: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 items-center gap-2 rounded-xl border p-2 text-left transition ${
        checked
          ? "border-cyan-300/35 bg-cyan-300/[0.07]"
          : "border-white/[0.08] hover:border-white/20 light:border-slate-200 light:hover:border-slate-300"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked
            ? "border-cyan-300 bg-cyan-300 text-zinc-950"
            : "border-zinc-600 light:border-slate-300"
        }`}
      >
        {checked && <Check size={10} weight="bold" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-zinc-200 light:text-slate-800">
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-[10px] text-zinc-600 light:text-slate-400">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-cyan-300/45 light:border-slate-200 light:bg-slate-50 light:text-slate-900 light:placeholder:text-slate-400";
export const primaryButtonClass =
  "h-9 rounded-xl bg-cyan-300 px-4 text-xs font-semibold text-zinc-950 hover:bg-cyan-200 disabled:opacity-50";
export const secondaryButtonClass =
  "h-9 rounded-xl border border-white/10 px-4 text-xs text-zinc-400 hover:bg-white/5 hover:text-white light:border-slate-200 light:text-slate-600 light:hover:bg-slate-100";
export const miniButtonClass =
  "inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2 text-[10px] text-theme-text-secondary hover:border-amber-300/30 hover:text-amber-200 light:border-slate-200 light:hover:text-amber-700";
