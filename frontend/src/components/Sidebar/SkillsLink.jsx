import { Sparkle } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";

export default function SkillsLink({ iconOnly = false }) {
  const { t } = useTranslation();
  return (
    <Link
      to={paths.personalSkills()}
      title={t("personal_skills.title")}
      aria-label={t("personal_skills.title")}
      className={`mb-2 flex h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300 bg-cyan-300 px-3 font-semibold text-slate-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 ${iconOnly ? "w-10 !px-0" : "w-full"}`}
    >
      <Sparkle size={20} weight="fill" aria-hidden="true" />
      {!iconOnly && t("personal_skills.title")}
    </Link>
  );
}
