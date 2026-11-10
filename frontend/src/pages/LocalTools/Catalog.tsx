import { Link } from "react-router-dom";
import { ArrowRight, FileDoc } from "@phosphor-icons/react";
import { isMobile } from "react-device-detect";
import { useTranslation } from "react-i18next";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import paths from "@/utils/paths";

// Each tool has its own route and catalog entry; the catalog owns no tool state.
const tools = [
  {
    id: "proposal-fill",
    path: paths.proposalFill,
    title: "local_tools.title",
    description: "local_tools.tool_summary",
    category: "local_tools.category",
    Icon: FileDoc,
  },
];

export default function ToolCatalog() {
  const { t } = useTranslation();
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-theme-bg-chat text-theme-text-primary">
      {isMobile ? <SidebarMobileHeader /> : <Sidebar />}
      <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-12 pt-24 md:px-8 md:pt-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-semibold">{t("local_tools.nav")}</h1>
          <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
            {t("local_tools.catalog_description")}
          </p>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {tools.map(({ id, path, title, description, category, Icon }) => (
              <li key={id}>
                <Link
                  to={path()}
                  className="group flex h-full flex-col rounded-lg border border-theme-sidebar-border p-5 transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
                >
                  <div className="flex items-center gap-2 text-xs text-theme-text-secondary">
                    <Icon size={20} />
                    {t(category)}
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">{t(title)}</h2>
                  <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
                    {t(description)}
                  </p>
                  <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
                    {t("local_tools.open_tool")}
                    <ArrowRight size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
