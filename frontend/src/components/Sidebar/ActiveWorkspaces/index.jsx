import React, { useState, useEffect, useRef } from "react";
import * as Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import Workspace from "@/models/workspace";
import ManageWorkspace, {
  useManageWorkspaceModal,
} from "../../Modals/ManageWorkspace";
import paths from "@/utils/paths";
import { Link, useParams, useNavigate, useMatch } from "react-router-dom";
import {
  CaretDown,
  CalendarDots,
  DotsThree,
  Folder,
  PencilSimple,
  FilePlus,
  GearSix,
  UserPlus,
} from "@phosphor-icons/react";
import useUser from "@/hooks/useUser";
import { useTranslation } from "react-i18next";
import ThreadContainer, { CreateThreadButton } from "./ThreadContainer";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import showToast from "@/utils/toast";
import { LAST_VISITED_WORKSPACE } from "@/utils/constants";
import { safeJsonParse } from "@/utils/request";
import {
  CLOSE_MOBILE_SIDEBAR_EVENT,
  WORKSPACE_CREATED_EVENT,
  WORKSPACE_RENAMED_EVENT,
} from "../events";
import WorkspaceInviteModal from "@/components/Modals/WorkspaceInvite";
import useAdminView from "@/hooks/useAdminView";
import { assignedAdminWorkspaces } from "@/utils/adminView";
import ContextMenu from "@/components/lib/ContextMenu";

let cachedWorkspaces = null;
let cachedOwner = null;

export default function ActiveWorkspaces() {
  const { user, authToken } = useUser();
  const { adminView, canUseAdminView } = useAdminView(user);
  return (
    <WorkspaceList
      key={`${user?.id ?? "single-user"}:${authToken ?? ""}:${adminView ? "admin" : "assigned"}`}
      adminView={adminView}
      canUseAdminView={canUseAdminView}
    />
  );
}

function WorkspaceList({ adminView, canUseAdminView }) {
  const { t } = useTranslation();
  const { user, authToken } = useUser();
  const expansionKey = `workspace-expansion:${user?.id ?? "single-user"}`;
  const owner = `${user?.id ?? "single-user"}:${authToken ?? ""}:${adminView ? "admin" : "assigned"}`;
  const navigate = useNavigate();
  const { slug } = useParams();
  const [loading, setLoading] = useState(
    () => cachedOwner !== owner || cachedWorkspaces === null
  );
  const [workspaces, setWorkspaces] = useState(() =>
    cachedOwner === owner ? cachedWorkspaces || [] : []
  );
  const [renamingSlug, setRenamingSlug] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedWs, setSelectedWs] = useState(null);
  const [inviteWorkspace, setInviteWorkspace] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [expansion, setExpansion] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(expansionKey));
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    } catch {
      return {};
    }
  });
  const renameInputRef = useRef(null);
  const renameSavingRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const { showing, showModal, hideModal } = useManageWorkspaceModal();
  const isInWorkspaceSettings = !!useMatch("/workspace/:slug/settings/:tab");
  const isHomePage = !!useMatch("/");

  useEffect(() => {
    let cancelled = false;
    async function getWorkspaces() {
      const visibleWorkspaces =
        canUseAdminView && !adminView
          ? await assignedAdminWorkspaces(user.id, { refresh: true })
          : await Workspace.all();
      const workspaces = Workspace.orderWorkspaces(visibleWorkspaces);
      if (cancelled) return;
      cachedOwner = owner;
      cachedWorkspaces = workspaces;
      setLoading(false);
      setWorkspaces(workspaces);
    }
    getWorkspaces();
    return () => {
      cancelled = true;
    };
  }, [adminView, canUseAdminView, owner, user?.id]);

  useEffect(() => {
    if (loading || !workspaces.length) return;
    const lastVisited = safeJsonParse(
      localStorage.getItem(LAST_VISITED_WORKSPACE)
    );
    const initialSlug =
      slug ||
      (isHomePage
        ? workspaces.find((workspace) => workspace.slug === lastVisited?.slug)
            ?.slug || workspaces[0].slug
        : null);
    if (!initialSlug) return;
    setExpansion((current) =>
      Object.hasOwn(current, initialSlug)
        ? current
        : { ...current, [initialSlug]: true }
    );
  }, [slug, isHomePage, loading, workspaces]);

  useEffect(() => {
    const workspaceCreated = (event) => {
      const workspace = event.detail?.workspace;
      if (!workspace?.slug) return;
      setWorkspaces((current) => {
        const next = current.some((item) => item.slug === workspace.slug)
          ? current
          : [...current, workspace];
        cachedWorkspaces = next;
        return next;
      });
    };
    const workspaceRenamed = (event) => {
      const { workspaceSlug, name } = event.detail || {};
      if (!workspaceSlug || !name) return;
      setWorkspaces((current) => {
        const next = current.map((item) =>
          item.slug === workspaceSlug ? { ...item, name } : item
        );
        cachedWorkspaces = next;
        return next;
      });
    };
    window.addEventListener(WORKSPACE_CREATED_EVENT, workspaceCreated);
    window.addEventListener(WORKSPACE_RENAMED_EVENT, workspaceRenamed);
    return () => {
      window.removeEventListener(WORKSPACE_CREATED_EVENT, workspaceCreated);
      window.removeEventListener(WORKSPACE_RENAMED_EVENT, workspaceRenamed);
    };
  }, []);

  useEffect(() => {
    if (!renamingSlug) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingSlug]);

  useEffect(() => {
    try {
      localStorage.setItem(expansionKey, JSON.stringify(expansion));
    } catch {
      /* Navigation still works when storage is unavailable. */
    }
  }, [expansion, expansionKey]);

  if (loading) {
    return (
      <Skeleton.default
        height={40}
        width="100%"
        count={5}
        baseColor="var(--theme-sidebar-item-default)"
        highlightColor="var(--theme-sidebar-item-hover)"
        enableAnimation={true}
        className="my-1"
      />
    );
  }

  /**
   * Reorders workspaces in the UI via localstorage on client side.
   * @param {number} startIndex - the index of the workspace to move
   * @param {number} endIndex - the index to move the workspace to
   */
  function reorderWorkspaces(startIndex, endIndex) {
    const reorderedWorkspaces = Array.from(workspaces);
    const [removed] = reorderedWorkspaces.splice(startIndex, 1);
    reorderedWorkspaces.splice(endIndex, 0, removed);
    setWorkspaces(reorderedWorkspaces);
    cachedWorkspaces = reorderedWorkspaces;
    const success = Workspace.storeWorkspaceOrder(
      reorderedWorkspaces.map((w) => w.id)
    );
    if (!success) {
      showToast(t("workspace_list.reorder_failed"), "error");
      const reload =
        canUseAdminView && !adminView
          ? assignedAdminWorkspaces(user.id, { refresh: true })
          : Workspace.all();
      reload.then((workspaces) => {
        cachedWorkspaces = Workspace.orderWorkspaces(workspaces);
        setWorkspaces(cachedWorkspaces);
      });
    }
  }

  const onDragEnd = (result) => {
    if (!result.destination) return;
    reorderWorkspaces(result.source.index, result.destination.index);
  };

  function startWorkspaceRename(workspace) {
    if (user?.role === "default") return;
    renameCancelledRef.current = false;
    setRenameValue(workspace.name);
    setRenamingSlug(workspace.slug);
  }

  function toggleWorkspace(workspaceSlug, isExpanded) {
    setExpansion((current) => ({ ...current, [workspaceSlug]: !isExpanded }));
  }

  function handleWorkspaceClick(event, workspace) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    window.dispatchEvent(new Event(CLOSE_MOBILE_SIDEBAR_EVENT));
    setExpansion((current) => ({ ...current, [workspace.slug]: true }));
    navigate(paths.workspace.chat(workspace.slug));
  }

  async function commitWorkspaceRename(workspace) {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }
    if (renameSavingRef.current) return;
    const name = renameValue.trim();
    if (!name || name === workspace.name) {
      setRenameValue(workspace.name);
      setRenamingSlug(null);
      return;
    }

    renameSavingRef.current = true;
    const { workspace: updatedWorkspace, message } = await Workspace.update(
      workspace.slug,
      { name }
    );
    renameSavingRef.current = false;
    if (!updatedWorkspace) {
      showToast(message || t("workspace_list.rename_failed"), "error", {
        clear: true,
      });
      renameInputRef.current?.focus();
      return;
    }

    window.dispatchEvent(
      new CustomEvent(WORKSPACE_RENAMED_EVENT, {
        detail: {
          workspaceSlug: workspace.slug,
          name: updatedWorkspace.name,
        },
      })
    );
    const lastVisited = safeJsonParse(
      localStorage.getItem(LAST_VISITED_WORKSPACE)
    );
    if (lastVisited?.slug === workspace.slug) {
      localStorage.setItem(
        LAST_VISITED_WORKSPACE,
        JSON.stringify({ ...lastVisited, name: updatedWorkspace.name })
      );
    }
    setRenamingSlug(null);
  }

  // When on the home page, resolve which workspace should be virtually active
  const virtualActiveSlug = (() => {
    if (!isHomePage || workspaces.length === 0) return null;
    const lastVisited = safeJsonParse(
      localStorage.getItem(LAST_VISITED_WORKSPACE)
    );
    if (
      lastVisited?.slug &&
      workspaces.some((ws) => ws.slug === lastVisited.slug)
    )
      return lastVisited.slug;
    return workspaces[0]?.slug ?? null;
  })();

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="workspaces">
        {(provided) => (
          <div
            role="list"
            aria-label={t("workbench_nav.workspaces")}
            className="flex flex-col gap-y-3"
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {workspaces.map((workspace, index) => {
              const isVirtuallyActive = workspace.slug === virtualActiveSlug;
              const isActive = workspace.slug === slug || isVirtuallyActive;
              const isExpanded = expansion[workspace.slug] ?? isActive;
              const canParticipate =
                workspace.viewerAccess !== "public_readonly";
              return (
                <Draggable
                  key={workspace.id}
                  draggableId={workspace.id.toString()}
                  index={index}
                >
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={`flex flex-col w-full group ${
                        snapshot.isDragging ? "opacity-50" : ""
                      }`}
                      role="listitem"
                    >
                      <div
                        className="group/workspace relative flex min-h-10 items-center hover:bg-theme-sidebar-subitem-hover focus-within:bg-theme-sidebar-subitem-hover"
                        onContextMenu={(event) => {
                          const canManage = user?.role !== "default";
                          if (!canManage && !canParticipate) return;
                          event.preventDefault();
                          setContextMenu({
                            point: { x: event.clientX, y: event.clientY },
                            workspace,
                            canParticipate,
                            canManage,
                          });
                        }}
                      >
                        <button
                          type="button"
                          aria-label={t(
                            isExpanded
                              ? "workspace_list.collapse"
                              : "workspace_list.expand",
                            { name: workspace.name }
                          )}
                          aria-expanded={isExpanded}
                          aria-controls={`workspace-threads-${workspace.id}`}
                          onClick={() =>
                            toggleWorkspace(workspace.slug, isExpanded)
                          }
                          className="flex h-10 w-7 shrink-0 items-center justify-center text-theme-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary"
                        >
                          <CaretDown
                            size={14}
                            className={isExpanded ? "" : "-rotate-90"}
                          />
                        </button>
                        {renamingSlug === workspace.slug ? (
                          <div className="flex min-w-0 flex-1 items-center pr-2">
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(event) =>
                                setRenameValue(event.target.value)
                              }
                              onBlur={() => commitWorkspaceRename(workspace)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  renameCancelledRef.current = true;
                                  setRenameValue(workspace.name);
                                  setRenamingSlug(null);
                                }
                              }}
                              aria-label={t("workspace_list.rename_workspace")}
                              className="h-8 min-w-0 flex-1 border border-theme-sidebar-border bg-theme-bg-chat px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-button-primary"
                            />
                          </div>
                        ) : (
                          <>
                            <span
                              {...provided.dragHandleProps}
                              aria-label={t("workspace_list.reorder", {
                                name: workspace.name,
                              })}
                              title={t("workspace_list.reorder", {
                                name: workspace.name,
                              })}
                              className="flex h-10 w-5 shrink-0 cursor-grab items-center justify-center text-theme-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
                            >
                              <Folder
                                size={16}
                                weight={isActive ? "fill" : "regular"}
                              />
                            </span>
                            <Link
                              to={paths.workspace.chat(workspace.slug)}
                              onClick={(event) =>
                                handleWorkspaceClick(event, workspace)
                              }
                              title={workspace.name}
                              className={`flex h-10 min-w-0 flex-1 items-center py-0 pl-1 pr-[72px] text-sm text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary md:pr-2 md:group-hover/workspace:pr-[72px] md:group-focus-within/workspace:pr-[72px] ${isActive ? "font-semibold" : "font-medium"}`}
                            >
                              <span className="truncate">{workspace.name}</span>
                            </Link>
                          </>
                        )}
                        {renamingSlug !== workspace.slug && (
                          <div className="absolute inset-y-0 right-0 flex items-center md:opacity-0 md:group-hover/workspace:opacity-100 md:group-focus-within/workspace:opacity-100">
                            {canParticipate && (
                              <CreateThreadButton
                                workspace={workspace}
                                onCreated={() =>
                                  setExpansion((current) => ({
                                    ...current,
                                    [workspace.slug]: true,
                                  }))
                                }
                              />
                            )}
                            <WorkspaceActionsMenu
                              workspace={workspace}
                              isActive={isActive}
                              isInWorkspaceSettings={isInWorkspaceSettings}
                              canParticipate={canParticipate}
                              canManage={user?.role !== "default"}
                              onRename={() => startWorkspaceRename(workspace)}
                              onInvite={() => setInviteWorkspace(workspace)}
                              onOpenFiles={() => {
                                setSelectedWs(workspace);
                                showModal();
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <div
                        id={`workspace-threads-${workspace.id}`}
                        hidden={!isExpanded}
                      >
                        <ThreadContainer
                          workspace={workspace}
                          expanded={isExpanded}
                        />
                      </div>
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
            {contextMenu && (
              <WorkspaceContextMenu
                {...contextMenu}
                onClose={() => setContextMenu(null)}
                onRename={() => startWorkspaceRename(contextMenu.workspace)}
                onInvite={() => setInviteWorkspace(contextMenu.workspace)}
                onOpenFiles={() => {
                  setSelectedWs(contextMenu.workspace);
                  showModal();
                }}
              />
            )}
            {showing && (
              <ManageWorkspace
                hideModal={hideModal}
                providedSlug={selectedWs ? selectedWs.slug : null}
                initialTab="workspaceFiles"
              />
            )}
            {inviteWorkspace && (
              <WorkspaceInviteModal
                workspace={inviteWorkspace}
                hideModal={() => setInviteWorkspace(null)}
              />
            )}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

function workspaceMenuActions({
  workspace,
  canParticipate,
  canManage,
  onRename,
  onInvite,
  onOpenFiles,
  navigate,
  t,
}) {
  return [
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
    canParticipate && {
      key: "invite",
      label: t("workspace-invite.action"),
      icon: UserPlus,
      action: onInvite,
    },
  ].filter(Boolean);
}

function WorkspaceMenuItems({ actions, onClose }) {
  return actions.map(({ key, label, icon: Icon, action }) => (
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
  ));
}

function WorkspaceContextMenu({
  point,
  workspace,
  canParticipate,
  canManage,
  onRename,
  onInvite,
  onOpenFiles,
  onClose,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actions = workspaceMenuActions({
    workspace,
    canParticipate,
    canManage,
    onRename,
    onInvite,
    onOpenFiles,
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

function WorkspaceActionsMenu({
  workspace,
  isActive,
  isInWorkspaceSettings,
  canParticipate,
  canManage,
  onInvite,
  onOpenFiles,
  onRename,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
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

  const runAction = (action) => {
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
        className={`flex h-9 w-8 items-center justify-center border-none text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${open || (isActive && isInWorkspaceSettings) ? "bg-theme-sidebar-subitem-selected text-theme-text-primary" : ""}`}
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
              ...event.currentTarget.querySelectorAll('[role="menuitem"]'),
            ];
            const index = items.indexOf(document.activeElement);
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
