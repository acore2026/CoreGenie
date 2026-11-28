import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarDots,
  DotsThree,
  FilePlus,
  Folder,
  GearSix,
  PencilSimple,
  Star,
  UserPlus,
  type Icon,
} from "@phosphor-icons/react";
import paths from "@/utils/paths";
import { workspaceScope } from "@/utils/workspaceGroups.ts";
import ContextMenu from "@/components/lib/ContextMenu";

export interface SidebarWorkspace {
  id: number;
  slug: string;
  name: string;
  accessMode?: string;
  viewerAccess?: string;
  [key: string]: unknown;
}

export interface WorkspaceMenuAction {
  key: string;
  label: string;
  icon: Icon;
  action: () => void;
}

function workspaceMenuActions({
  workspace,
  canParticipate,
  canManage,
  onRename,
  onInvite,
  onOpenFiles,
  onGroup,
  starred,
  onStar,
  navigate,
  t,
}: {
  workspace: SidebarWorkspace;
  canParticipate: boolean;
  canManage: boolean;
  onRename: () => void;
  onInvite: () => void;
  onOpenFiles: () => void;
  onGroup: () => void;
  starred: boolean;
  onStar: () => void;
  navigate: ReturnType<typeof useNavigate>;
  t: (key: string) => string;
}): WorkspaceMenuAction[] {
  const candidates: Array<WorkspaceMenuAction | false> = [
    {
      key: "star",
      label: t(starred ? "favorites.unstar" : "favorites.star"),
      icon: Star,
      action: onStar,
    },
    {
      key: "group",
      label: t("workspace_groups.assign"),
      icon: Folder,
      action: onGroup,
    },
    canManage && {
      key: "rename",
      label: t("workspace_list.rename_workspace"),
      icon: PencilSimple,
      action: onRename,
    },
    canManage && {
      key: "settings",
      label: t("sidebar-workspace-menu.settings"),
      icon: GearSix,
      action: () =>
        navigate(paths.workspace.settings.generalAppearance(workspace.slug)),
    },
    canManage && {
      key: "files",
      label: t("chat_window.workspace_files.title"),
      icon: FilePlus,
      action: onOpenFiles,
    },
    canParticipate && {
      key: "jobs",
      label: t("scheduledJobs.workspaceAction"),
      icon: CalendarDots,
      action: () => navigate(paths.workspace.jobs(workspace.slug)),
    },
    canParticipate &&
      workspaceScope(workspace) === "private" && {
        key: "invite",
        label: t("workspace-invite.action"),
        icon: UserPlus,
        action: onInvite,
      },
  ];
  return candidates.filter((item): item is WorkspaceMenuAction =>
    Boolean(item)
  );
}

function WorkspaceMenuItems({
  actions,
  onClose,
}: {
  actions: WorkspaceMenuAction[];
  onClose: () => void;
}) {
  return (
    <>
      {actions.map(({ key, label, icon: Icon, action }) => (
        <button
          key={key}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            action();
          }}
          className="dsh-menu-item"
        >
          <Icon size={17} weight="bold" className="shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </>
  );
}

interface WorkspaceContextMenuProps {
  point: { x: number; y: number };
  workspace: SidebarWorkspace;
  canParticipate: boolean;
  canManage: boolean;
  onRename: () => void;
  onInvite: () => void;
  onOpenFiles: () => void;
  onGroup: () => void;
  starred: boolean;
  onStar: () => void;
  onClose: () => void;
}

export function WorkspaceContextMenu({
  point,
  workspace,
  canParticipate,
  canManage,
  onRename,
  onInvite,
  onOpenFiles,
  onGroup,
  starred,
  onStar,
  onClose,
}: WorkspaceContextMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actions = workspaceMenuActions({
    workspace,
    canParticipate,
    canManage,
    onRename,
    onInvite,
    onOpenFiles,
    onGroup,
    starred,
    onStar,
    navigate,
    t,
  });
  return (
    <ContextMenu
      point={point}
      label={t("sidebar-workspace-menu.title")}
      onClose={onClose}
    >
      <WorkspaceMenuItems actions={actions} onClose={onClose} />
    </ContextMenu>
  );
}

interface WorkspaceActionsMenuProps {
  workspace: SidebarWorkspace;
  isActive: boolean;
  isInWorkspaceSettings: boolean;
  canParticipate: boolean;
  canManage: boolean;
  onInvite: () => void;
  onOpenFiles: () => void;
  onRename: () => void;
  onGroup: () => void;
  starred: boolean;
  onStar: () => void;
}

export function WorkspaceActionsMenu({
  workspace,
  isActive,
  isInWorkspaceSettings,
  canParticipate,
  canManage,
  onInvite,
  onOpenFiles,
  onRename,
  onGroup,
  starred,
  onStar,
}: WorkspaceActionsMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    (
      menuRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null
    )?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const runAction = (action: () => void) => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  };

  const actions = workspaceMenuActions({
    workspace,
    canParticipate,
    canManage,
    onRename,
    onInvite,
    onOpenFiles,
    onGroup,
    starred,
    onStar,
    navigate,
    t,
  });

  if (actions.length === 0) return null;

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar-workspace-menu.title")}
        data-tooltip-id="gear-workspace"
        data-tooltip-content={t("sidebar-workspace-menu.title")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={`flex h-9 w-8 items-center justify-center border-none text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button ${open || (isActive && isInWorkspaceSettings) ? "bg-theme-sidebar-subitem-selected text-theme-text-primary" : ""}`}
      >
        <DotsThree size={20} weight="bold" />
      </button>
      {open && (
        <div
          role="menu"
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitem"]'
              ),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }}
          aria-label={t("sidebar-workspace-menu.title")}
          className="dsh-menu absolute right-0 top-9 z-[70] w-[190px]"
        >
          <WorkspaceMenuItems
            actions={actions}
            onClose={() => runAction(() => {})}
          />
        </div>
      )}
    </div>
  );
}
