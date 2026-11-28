import { useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CaretDown, Star } from "@phosphor-icons/react";
import paths from "@/utils/paths";
import { workspaceScope } from "@/utils/workspaceGroups.mjs";
import type { SidebarWorkspace } from "./WorkspaceMenu";

interface WorkspaceGroupItem {
  id: string;
  scope: string;
  name: string;
  global?: boolean;
}

interface StarredWorkspacesSectionProps {
  workspaces: SidebarWorkspace[];
  favoriteWorkspaceIds: number[];
  groupSettings: {
    groups: WorkspaceGroupItem[];
    assignments: Record<number | string, string>;
  };
  onWorkspaceClick: (
    event: MouseEvent<HTMLAnchorElement>,
    workspace: SidebarWorkspace
  ) => void;
  onStarWorkspace: (workspace: SidebarWorkspace) => void;
}

export function StarredWorkspacesSection({
  workspaces,
  favoriteWorkspaceIds,
  groupSettings,
  onWorkspaceClick,
  onStarWorkspace,
}: StarredWorkspacesSectionProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const starredWorkspaces = workspaces.filter((workspace) =>
    favoriteWorkspaceIds.includes(workspace.id)
  );

  return (
    <section aria-label={t("favorites.workspaces")}>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-controls="starred-workspaces"
        className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
      >
        <Star
          size={15}
          weight="fill"
          className="text-amber-400 light:text-amber-700"
        />
        <span>{t("favorites.workspaces")}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums">
          {starredWorkspaces.length}
        </span>
        <CaretDown size={12} className={collapsed ? "-rotate-90" : ""} />
      </button>
      <div id="starred-workspaces" hidden={collapsed}>
        {starredWorkspaces.map((workspace) => {
          const group = groupSettings.groups.find(
            (item) =>
              item.id === groupSettings.assignments[workspace.id] &&
              item.scope === workspaceScope(workspace)
          );
          return (
            <div
              key={workspace.id}
              className="group/starred flex min-w-0 items-center rounded-md hover:bg-theme-sidebar-subitem-hover"
            >
              <Link
                to={paths.workspace.chat(workspace.slug)}
                onClick={(event) => onWorkspaceClick(event, workspace)}
                className="min-w-0 flex-1 rounded-md py-2 pl-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
                title={workspace.name}
              >
                <span className="block truncate text-sm font-medium text-theme-text-primary">
                  {workspace.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-theme-text-secondary">
                  {t(`workspace_groups.${workspaceScope(workspace)}`)}
                  {group ? ` · ${group.name}` : ""}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => onStarWorkspace(workspace)}
                aria-label={t("favorites.unstar_workspace", {
                  name: workspace.name,
                })}
                title={t("favorites.unstar")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-amber-400 hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button light:text-amber-700"
              >
                <Star size={14} weight="fill" />
              </button>
            </div>
          );
        })}
        {starredWorkspaces.length === 0 && (
          <p className="px-7 py-2 text-xs leading-5 text-theme-text-secondary">
            {t("favorites.empty")}
          </p>
        )}
      </div>
    </section>
  );
}
