import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Workspace from "@/models/workspace";
import PasswordModal, { usePasswordModal } from "@/components/Modals/Password";
import { ContentLoader } from "@/components/Preloader";
import {
  ChatText,
  Database,
  Robot,
  User,
  Wrench,
  X,
} from "@phosphor-icons/react";
import paths from "@/utils/paths";
import { Link, NavLink, useNavigate } from "react-router-dom";
import GeneralAppearance from "./GeneralAppearance";
import ChatSettings from "./ChatSettings";
import VectorDatabase from "./VectorDatabase";
import Members from "./Members";
import WorkspaceAgentConfiguration from "./AgentConfig";
import useUser from "@/hooks/useUser";
import { useTranslation } from "react-i18next";
import System from "@/models/system";
import {
  SettingsModalBackdrop,
  useSettingsModal,
} from "@/components/SettingsModal";
import { getSettingsReturnPath } from "@/utils/settingsModal";

const TABS = {
  "general-appearance": GeneralAppearance,
  "chat-settings": ChatSettings,
  "vector-database": VectorDatabase,
  members: Members,
  "agent-config": WorkspaceAgentConfiguration,
};

export default function WorkspaceSettings() {
  const { loading, requiresAuth, mode } = usePasswordModal();

  if (loading) return <WorkspaceSettingsLoadingShell />;
  if (requiresAuth !== false) {
    return <>{requiresAuth !== null && <PasswordModal mode={mode} />}</>;
  }

  return <ShowWorkspaceChat />;
}

function ShowWorkspaceChat() {
  const { t } = useTranslation();
  const { slug, tab } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();
  const dialogRef = useRef(null);
  const [workspace, setWorkspace] = useState(null);
  const [deletionProtected, setDeletionProtected] = useState(false);
  const [loading, setLoading] = useState(true);
  const returnPath = getSettingsReturnPath();
  const closeSettings = useCallback(
    () => navigate(returnPath, { replace: true }),
    [navigate, returnPath]
  );

  useSettingsModal({
    anchorRef: dialogRef,
    onDismiss: closeSettings,
    labelledBy: "workspace-settings-title",
    anchorIsDialog: true,
    active: !loading,
  });

  useEffect(() => {
    async function getWorkspace() {
      if (!slug) return;
      const _workspace = await Workspace.bySlug(slug);
      if (!_workspace) {
        setLoading(false);
        return;
      }

      const _settings = await System.keys();
      const suggestedMessages = await Workspace.getSuggestedMessages(slug);
      setWorkspace({
        ..._workspace,
        vectorDB: _settings?.VectorDB,
        suggestedMessages,
      });
      setDeletionProtected(_settings?.WorkspaceDeletionProtection === true);
      setLoading(false);
    }
    getWorkspace();
  }, [slug]);

  if (loading) return <WorkspaceSettingsLoadingShell />;

  const TabContent = TABS[tab];
  return (
    <div
      ref={dialogRef}
      className="settings-modal-route"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-settings-title"
    >
      <SettingsModalBackdrop onDismiss={closeSettings} />
      <section className="workspace-settings-panel flex h-full w-full min-w-0 flex-col overflow-hidden bg-theme-bg-secondary md:h-[min(800px,calc(100vh-48px))] md:max-w-[1040px] md:flex-row md:rounded-2xl md:border md:border-theme-sidebar-border">
        <aside className="flex w-full shrink-0 flex-col border-b border-theme-sidebar-border px-3 pb-3 pt-4 md:w-[220px] md:border-b-0 md:border-r md:pb-4 md:pt-5">
          <div className="px-3 pb-3 md:pb-4">
            <h1
              id="workspace-settings-title"
              className="text-base font-semibold text-theme-text-primary"
            >
              {t("workspaces—settings.title")}
            </h1>
            <p className="mt-1 truncate text-xs text-theme-text-secondary">
              {workspace.name}
            </p>
          </div>
          <nav
            aria-label={t("workspaces—settings.title")}
            className="sidebar-scrollbar flex min-h-0 flex-1 gap-1 overflow-x-auto md:block md:space-y-1 md:overflow-x-hidden md:overflow-y-auto"
          >
            <TabItem
              title={t("workspaces—settings.general")}
              icon={<Wrench size={18} />}
              to={paths.workspace.settings.generalAppearance(slug)}
            />
            <TabItem
              title={t("workspaces—settings.chat")}
              icon={<ChatText size={18} />}
              to={paths.workspace.settings.chatSettings(slug)}
            />
            <TabItem
              title={t("workspaces—settings.vector")}
              icon={<Database size={18} />}
              to={paths.workspace.settings.vectorDatabase(slug)}
            />
            <TabItem
              title={t("workspaces—settings.members")}
              icon={<User size={18} />}
              to={paths.workspace.settings.members(slug)}
              visible={["admin", "manager"].includes(user?.role)}
            />
            <TabItem
              title={t("workspaces—settings.agent")}
              icon={<Robot size={18} />}
              to={paths.workspace.settings.agentConfig(slug)}
            />
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-end px-4">
            <Link
              to={returnPath}
              replace
              data-settings-close
              aria-label={t("settings.back-to-chat")}
              title={t("settings.back-to-chat")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
            >
              <X size={16} weight="bold" />
            </Link>
          </header>
          <div className="workspace-settings-content sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-8 md:px-8">
            <TabContent
              slug={slug}
              workspace={workspace}
              deletionProtected={deletionProtected}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function WorkspaceSettingsPanelSkeleton() {
  return (
    <section className="workspace-settings-panel flex h-full w-full min-w-0 flex-col overflow-hidden bg-theme-bg-secondary md:h-[min(800px,calc(100vh-48px))] md:max-w-[1040px] md:flex-row md:rounded-2xl md:border md:border-theme-sidebar-border">
      <div className="w-full shrink-0 border-b border-theme-sidebar-border p-5 md:w-[220px] md:border-b-0 md:border-r">
        <div className="h-5 w-24 rounded bg-theme-sidebar-subitem-selected" />
        <div className="mt-5 space-y-2">
          {[0, 1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-10 rounded-lg bg-theme-sidebar-subitem-selected"
            />
          ))}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        <ContentLoader label="正在加载工作区设置" />
      </div>
    </section>
  );
}

function WorkspaceSettingsLoadingShell() {
  return (
    <div className="settings-modal-route">
      <div className="settings-modal-backdrop" />
      <WorkspaceSettingsPanelSkeleton />
    </div>
  );
}

function TabItem({ title, icon, to, visible = true }) {
  if (!visible) return null;
  return (
    <NavLink
      to={to}
      replace
      className={({ isActive }) =>
        `flex h-10 w-auto shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary md:w-full ${
          isActive
            ? "bg-theme-sidebar-subitem-selected font-medium text-theme-text-primary"
            : "text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary"
        }`
      }
    >
      {icon}
      <span className="truncate">{title}</span>
    </NavLink>
  );
}
