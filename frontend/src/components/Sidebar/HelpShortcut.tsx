import { Question } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";

export default function HelpShortcut({ iconOnly = false }) {
  const { t } = useTranslation();

  if (iconOnly)
    return (
      <Link
        to={paths.help()}
        aria-label={t("help.navigation")}
        title={t("help.navigation")}
        className="flex h-9 w-9 items-center justify-center rounded-md text-theme-text-secondary transition-colors hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
      >
        <Question size={20} weight="duotone" />
      </Link>
    );

  return (
    <Link
      to={paths.help()}
      className="mx-3 mb-2 flex min-h-10 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-theme-text-secondary transition-colors hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
    >
      <Question size={16} weight="duotone" className="shrink-0" />
      <span>{t("help.navigation")}</span>
    </Link>
  );
}
