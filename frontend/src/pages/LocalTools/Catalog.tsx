import { Link } from "react-router-dom";
import { ArrowRight } from "@phosphor-icons/react";
import { isMobile } from "react-device-detect";
import { useTranslation } from "react-i18next";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import paths from "@/utils/paths";
import PlannedToolSketch from "./PlannedToolSketch";
import ToolLogo, { type LocalToolId } from "./ToolLogo";

// Each tool has its own route and catalog entry; the catalog owns no tool state.
const tools: Array<{
  id: LocalToolId;
  path: () => string;
  title: string;
  description: string;
  category: string;
}> = [
  {
    id: "protocol-finder",
    path: paths.protocolFinder,
    title: "local_tools.protocol.title",
    description: "local_tools.protocol.description",
    category: "local_tools.protocol.category",
  },
  {
    id: "proposal-fill",
    path: paths.proposalFill,
    title: "local_tools.title",
    description: "local_tools.tool_summary",
    category: "local_tools.category",
  },
];

const plannedCategories = ["documents", "data", "meetings"] as const;

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
          <section className="mt-8" aria-labelledby="standard-tools-title">
            <h2 id="standard-tools-title" className="text-lg font-semibold">
              {t("local_tools.catalog.standards")}
            </h2>
            <ul className="mt-3 grid gap-4 md:grid-cols-2">
              {tools.map(({ id, path, title, description, category }) => (
                <li key={id}>
                  <Link
                    to={path()}
                    className="group flex h-full flex-col rounded-xl border border-theme-sidebar-border border-l-[3px] border-l-cyan-500 p-5 transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
                  >
                    <div className="flex items-center gap-3">
                      <ToolLogo tool={id} size="sm" />
                      <div className="min-w-0">
                        <div className="text-xs text-theme-text-secondary">
                          {t(category)}
                        </div>
                        <h3 className="mt-0.5 text-lg font-semibold">
                          {t(title)}
                        </h3>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-theme-text-secondary">
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
          </section>
          <section
            className="mt-8 border-t border-theme-sidebar-border pt-6"
            aria-labelledby="planned-tools-title"
          >
            <h2 id="planned-tools-title" className="text-lg font-semibold">
              {t("local_tools.catalog.planned")}
            </h2>
            <ul className="mt-3 grid gap-4 sm:grid-cols-3">
              {plannedCategories.map((title) => (
                <li key={title} className="min-w-0">
                  <PlannedToolSketch tool={title} />
                  <h3 className="mt-3 text-base font-semibold">
                    {t(`local_tools.catalog.${title}`)}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-theme-text-secondary">
                    {t(`local_tools.catalog.${title}_hint`)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
