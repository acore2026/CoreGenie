import { Books, Brain, Database, Sparkle, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

const variants = {
  skill: {
    icon: Sparkle,
    label: "SKILL",
    colorClass:
      "border-amber-400/40 text-amber-300 light:border-amber-400 light:text-amber-700",
  },
  memory: {
    icon: Brain,
    label: "MEMORY",
    colorClass:
      "border-cyan-400/40 text-cyan-300 light:border-cyan-500 light:text-cyan-700",
  },
  "memory-store": {
    icon: Database,
    label: "SAVED",
    colorClass:
      "border-emerald-400/40 text-emerald-300 light:border-emerald-500 light:text-emerald-700",
  },
  "memory-delete": {
    icon: Trash,
    label: "DELETED",
    colorClass:
      "border-rose-400/40 text-rose-300 light:border-rose-500 light:text-rose-700",
  },
  rag: {
    icon: Books,
    label: "RAG",
    colorClass:
      "border-violet-400/40 text-violet-300 light:border-violet-500 light:text-violet-700",
  },
};

const fallbackVariant = variants.memory;

export default function ContextTrace({ trace = {}, compact = false }) {
  const { t } = useTranslation();
  const variant = variants[trace.kind] || fallbackVariant;
  const Icon = variant.icon;
  const items = Array.isArray(trace.items) ? trace.items : [];
  const scopes = Array.isArray(trace.scopes) ? trace.scopes : [];
  const secondary = items.length > 0 ? items.join(", ") : trace.detail;
  const title = trace.titleKey
    ? t(
        `chat_window.agent_invocation.context_event.${trace.titleKey}`,
        trace.titleArgs || {}
      )
    : trace.title || t("chat_window.agent_invocation.context_event.used");

  const bar = (
    <div
      className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-r-lg border-l-2 bg-white/[0.025] px-2.5 light:bg-slate-50 ${compact ? "max-w-none" : "max-w-[750px]"} ${variant.colorClass}`}
    >
      <Icon size={14} weight="duotone" className="shrink-0" />
      <span className="shrink-0 text-[9px] font-bold tracking-[0.14em]">
        {variant.label}
      </span>
      <span className="truncate text-xs font-medium text-zinc-200 light:text-slate-800">
        {title}
        {secondary ? (
          <span className="font-normal text-zinc-500 light:text-slate-500">
            {` · ${secondary}`}
          </span>
        ) : null}
      </span>
      {scopes.length > 0 && (
        <span className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 light:text-slate-500">
          {scopes.join(" + ")}
        </span>
      )}
    </div>
  );

  if (compact) return bar;

  return <div className="flex w-full justify-start pr-4">{bar}</div>;
}
