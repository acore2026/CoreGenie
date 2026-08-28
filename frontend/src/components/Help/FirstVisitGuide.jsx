import { ArrowRight, Question, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";
import { SEEN_HELP_INTRO } from "@/utils/constants";

function wasDismissed() {
  try {
    return localStorage.getItem(SEEN_HELP_INTRO) === "true";
  } catch {
    return false;
  }
}

export default function FirstVisitGuide() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => !wasDismissed());

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(SEEN_HELP_INTRO, "true");
    } catch {}
    setVisible(false);
  }

  return (
    <aside className="mb-4 flex w-[95vw] max-w-[750px] items-center gap-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.045] px-3 py-2.5 text-left light:border-cyan-600/15 light:bg-cyan-50/70">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/15 text-cyan-300 light:border-cyan-600/20 light:text-cyan-700">
        <Question size={16} weight="duotone" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-zinc-100 light:text-slate-900">
          {t("help.intro.title")}
        </p>
        <p className="mt-0.5 hidden text-[11px] leading-4 text-zinc-500 light:text-slate-500 sm:block">
          {t("help.intro.description")}
        </p>
      </div>
      <Link
        to={paths.help()}
        onClick={dismiss}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-300/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 light:text-cyan-800 light:hover:bg-cyan-100"
      >
        {t("help.intro.action")}
        <ArrowRight size={13} weight="bold" />
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("help.intro.dismiss")}
        title={t("help.intro.dismiss")}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 light:hover:bg-slate-100 light:hover:text-slate-800"
      >
        <X size={14} />
      </button>
    </aside>
  );
}
