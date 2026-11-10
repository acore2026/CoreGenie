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
  Star,
} from "@phosphor-icons/react";
import useUser from "@/hooks/useUser";
import { useTranslation } from "react-i18next";
import ThreadContainer, { CreateThreadButton } from "./ThreadContainer";
import { DragDropContext, Draggable } from "react-beautiful-dnd";
import { v4 as uuidv4 } from "uuid";
import { WorkspaceGroupSection, WorkspaceGroupDialog } from "./WorkspaceGroups";
import {
  GROUP_SCOPES,
  workspaceScope,
  removeWorkspaceGroup,
  moveGroupedWorkspace,
  effectiveWorkspaceGroups,
  personalWorkspaceGroups,
  assignWorkspaceGroups,
  groupDropDestination,
  workspaceGroupId,
} from "@/utils/workspaceGroups.mjs";
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
import useWorkspaceFavorites from "@/hooks/useWorkspaceFavorites";
import useSidebarPreferences from "@/hooks/useSidebarPreferences";

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
  const { favorites, toggle: toggleFavorite } = useWorkspaceFavorites();
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);
  function starWorkspace(workspace) {
    if (!toggleFavorite("workspaces", workspace.id))
      showToast(t("favorites.save_failed"), "error");
  }
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
  const {
    preferences,
    save: savePreferences,
    ready,
    saving,
  } = useSidebarPreferences();
  const canManageGlobal = !user || user.role === "admin";
  const groupSettings = effectiveWorkspaceGroups(
    preferences.groups,
    preferences.globalGroups
  );
  const [groupDialog, setGroupDialog] = useState(null);
  const [dragScope, setDragScope] = useState(null);
  const [dragHeader, setDragHeader] = useState(null);
  const dragHeaderRef = useRef(null);
  useEffect(() => {
    if (!dragScope) return;
    function trackHeader(event) {
      const point = event.touches?.[0] || event;
      const header = [
        ...document.querySelectorAll("[data-workspace-group-drop-target]"),
      ].find((element) => {
        if (element.dataset.workspaceGroupDropScope !== dragScope) return false;
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          point.clientX >= rect.left &&
          point.clientX <= rect.right &&
          point.clientY >= rect.top &&
          point.clientY <= rect.bottom
        );
      });
      const id = header?.dataset.workspaceGroupDropTarget || null;
      dragHeaderRef.current = id;
      setDragHeader(id);
    }
    document.addEventListener("mousemove", trackHeader);
    document.addEventListener("touchmove", trackHeader, { passive: true });
    return () => {
      document.removeEventListener("mousemove", trackHeader);
      document.removeEventListener("touchmove", trackHeader);
    };
  }, [dragScope]);

  function saveGroups(next) {
    const personal = personalWorkspaceGroups(
      preferences.groups,
      groupSettings,
      next,
      preferences.globalGroups
    );
    return savePreferences(
      { type: "groups", before: preferences.groups, next: personal },
      { ...preferences, groups: personal }
    );
  }

  function moveGroupWorkspaces(ids, targetId, sourceGroup) {
    const sourceSettings = sourceGroup?.global
      ? {
          ...groupSettings,
          assignments: preferences.globalGroups?.assignments || {},
        }
      : groupSettings;
    if (
      sourceGroup &&
      ids.some((id) => {
        const workspace = workspaces.find((workspace) => workspace.id === id);
        return (
          !workspace ||
          workspaceGroupId(workspace, sourceSettings) !== sourceGroup.id
        );
      })
    )
      return false;
    const next = assignWorkspaceGroups(
      sourceSettings,
      workspaces,
      ids,
      targetId
    );
    if (!next) return false;
    if (sourceGroup?.global) {
      if (!canManageGlobal) return false;
      const target = groupSettings.groups.find(
        (group) => group.id === targetId
      );
      if (target && !target.global) return false;
      const assignments = { ...preferences.groups.assignments };
      for (const id of ids)
        if (assignments[id] === sourceGroup.id) delete assignments[id];
      return savePreferences(
        {
          type: "global-group",
          action: "move",
          id: sourceGroup.id,
          workspaceIds: ids,
          targetGroupId: targetId,
        },
        {
          ...preferences,
          groups: {
            ...preferences.groups,
            assignments,
            collapsed: next.collapsed,
          },
          globalGroups: {
            ...preferences.globalGroups,
            assignments: next.assignments,
          },
        }
      );
    }
    return saveGroups(next);
  }

  function saveGroupDialog(value, global) {
    if (global || groupDialog.group?.global) {
      if (!canManageGlobal) return false;
      const operation = groupDialog.group
        ? {
            type: "global-group",
            action: "rename",
            id: groupDialog.group.id,
            name: value,
          }
        : {
            type: "global-group",
            action: "create",
            scope: groupDialog.scope,
            name: value,
            ...(groupDialog.workspace
              ? { workspaceId: groupDialog.workspace.id }
              : {}),
          };
      if (!savePreferences(operation, preferences)) return false;
      setGroupDialog(null);
      return true;
    }
    let next = groupSettings;
    if (groupDialog.mode === "assign") {
      const assignments = { ...next.assignments };
      if (GROUP_SCOPES.includes(value))
        delete assignments[groupDialog.workspace.id];
      else assignments[groupDialog.workspace.id] = value;
      next = {
        ...next,
        assignments,
        collapsed: { ...next.collapsed, [value]: false },
      };
    } else if (groupDialog.group) {
      next = {
        ...next,
        groups: next.groups.map((group) =>
          group.id === groupDialog.group.id ? { ...group, name: value } : group
        ),
      };
    } else {
      const group = {
        id: `group-${uuidv4()}`,
        scope: groupDialog.scope,
        name: value,
      };
      next = {
        ...next,
        groups: [...next.groups, group],
        collapsed: { ...next.collapsed, [group.scope]: false },
        assignments: {
          ...next.assignments,
          ...(groupDialog.workspace
            ? { [groupDialog.workspace.id]: group.id }
            : {}),
        },
      };
    }
    if (!saveGroups(next)) return false;
    setGroupDialog(null);
    return true;
  }
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
      setLoading(false);
      setWorkspaces(workspaces);
    }
    getWorkspaces();
    return () => {
      cancelled = true;
    };
  }, [adminView, canUseAdminView, owner, user?.id]);

  useEffect(() => {
    if (loading) return;
    cachedOwner = owner;
    cachedWorkspaces = workspaces;
  }, [loading, owner, workspaces]);

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
        const next = Workspace.orderWorkspaces(
          current.some((item) => item.slug === workspace.slug)
            ? current
            : [...current, workspace]
        );
        return next;
      });
    };
    const workspaceRenamed = (event) => {
      const { workspaceSlug, name } = event.detail || {};
      if (!workspaceSlug || !name) return;
      setWorkspaces((current) => {
        const next = Workspace.orderWorkspaces(
          current.map((item) =>
            item.slug === workspaceSlug ? { ...item, name } : item
          )
        );
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

  function reorderWorkspaces(reorderedWorkspaces) {
    setWorkspaces(Workspace.orderWorkspaces(reorderedWorkspaces));
  }

  const onDragEnd = (result) => {
    const header = dragHeaderRef.current;
    dragHeaderRef.current = null;
    setDragHeader(null);
    setDragScope(null);
    if (result.reason !== "DROP") return;
    const destination = header
      ? { droppableId: header, index: 0 }
      : groupDropDestination(result.destination);
    if (!destination) return;
    if (result.source.droppableId === destination.droppableId) return;
    const sourceGroup = groupSettings.groups.find(
      (group) => group.id === result.source.droppableId
    );
    const targetGroup = groupSettings.groups.find(
      (group) => group.id === destination.droppableId
    );
    const moving = workspaces.filter(
      (workspace) =>
        workspaceGroupId(workspace, groupSettings) === result.source.droppableId
    )[result.source.index];
    if (
      moving &&
      sourceGroup?.global &&
      canManageGlobal &&
      (!targetGroup || targetGroup.global) &&
      preferences.globalGroups?.assignments?.[moving.id] === sourceGroup.id
    ) {
      moveGroupWorkspaces([moving.id], destination.droppableId, sourceGroup);
      return;
    }
    const next = moveGroupedWorkspace(
      workspaces,
      groupSettings,
      result.source,
      destination
    );
    if (!next || !saveGroups(next.settings)) return;
    reorderWorkspaces(next.workspaces);
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

  function renderWorkspace(workspace, index) {
    const isVirtuallyActive = workspace.slug === virtualActiveSlug;
    const isActive = workspace.slug === slug || isVirtuallyActive;
    const isExpanded = expansion[workspace.slug] ?? isActive;
    const canParticipate = workspace.viewerAccess !== "public_readonly";
    return (
      <Draggable
        key={workspace.id}
        draggableId={workspace.id.toString()}
        index={index}
        isDragDisabled={!ready || saving || renamingSlug === workspace.slug}
      >
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            style={workspaceDragStyle(provided.draggableProps.style)}
            className={`flex flex-col w-full group ${
              snapshot.isDragging ? "opacity-50" : ""
            }`}
            role="listitem"
          >
            <div
              className="group/workspace relative flex min-h-10 items-center hover:bg-theme-sidebar-subitem-hover focus-within:bg-theme-sidebar-subitem-hover"
              onContextMenu={(event) => {
                const canManage = user?.role !== "default";
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
                onClick={() => toggleWorkspace(workspace.slug, isExpanded)}
                className="flex h-10 w-7 shrink-0 items-center justify-center text-theme-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-button"
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
                    onChange={(event) => setRenameValue(event.target.value)}
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
                    className="h-8 min-w-0 flex-1 border border-theme-sidebar-border bg-theme-bg-chat px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button"
                  />
                </div>
              ) : (
                <>
                  <Link
                    {...provided.dragHandleProps}
                    to={paths.workspace.chat(workspace.slug)}
                    onClick={(event) => handleWorkspaceClick(event, workspace)}
                    title={workspace.name}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex h-10 min-w-0 flex-1 items-center py-0 pl-1 pr-[72px] text-sm text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-button md:pr-2 md:group-hover/workspace:pr-[72px] md:group-focus-within/workspace:pr-[72px] ${isActive ? "font-semibold" : "font-medium"}`}
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
                    onGroup={() =>
                      setGroupDialog({ mode: "assign", workspace })
                    }
                    starred={favorites.workspaces.includes(workspace.id)}
                    onStar={() => starWorkspace(workspace)}
                    onInvite={() => setInviteWorkspace(workspace)}
                    onOpenFiles={() => {
                      setSelectedWs(workspace);
                      showModal();
                    }}
                  />
                </div>
              )}
            </div>
            <div id={`workspace-threads-${workspace.id}`} hidden={!isExpanded}>
              <ThreadContainer workspace={workspace} expanded={isExpanded} />
            </div>
          </div>
        )}
      </Draggable>
    );
  }

  return (
    <DragDropContext
      onDragEnd={onDragEnd}
      onDragStart={(result) =>
        setDragScope(
          workspaceScope(
            workspaces.find(
              (workspace) => String(workspace.id) === result.draggableId
            )
          )
        )
      }
    >
      <div
        className="flex flex-col gap-y-4"
        aria-label={t("workbench_nav.workspaces")}
      >
        <section aria-label={t("favorites.workspaces")}>
          <button
            type="button"
            onClick={() => setFavoritesCollapsed((value) => !value)}
            aria-expanded={!favoritesCollapsed}
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
              {
                workspaces.filter((workspace) =>
                  favorites.workspaces.includes(workspace.id)
                ).length
              }
            </span>
            <CaretDown
              size={12}
              className={favoritesCollapsed ? "-rotate-90" : ""}
            />
          </button>
          <div id="starred-workspaces" hidden={favoritesCollapsed}>
            {workspaces
              .filter((workspace) =>
                favorites.workspaces.includes(workspace.id)
              )
              .map((workspace) => {
                const group = groupSettings.groups.find(
                  (group) =>
                    group.id === groupSettings.assignments[workspace.id] &&
                    group.scope === workspaceScope(workspace)
                );
                return (
                  <div
                    key={workspace.id}
                    className="group/starred flex min-w-0 items-center rounded-md hover:bg-theme-sidebar-subitem-hover"
                  >
                    <Link
                      to={paths.workspace.chat(workspace.slug)}
                      onClick={(event) =>
                        handleWorkspaceClick(event, workspace)
                      }
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
                      onClick={() => starWorkspace(workspace)}
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
            {!workspaces.some((workspace) =>
              favorites.workspaces.includes(workspace.id)
            ) && (
              <p className="px-7 py-2 text-xs leading-5 text-theme-text-secondary">
                {t("favorites.empty")}
              </p>
            )}
          </div>
        </section>
        {GROUP_SCOPES.map((scope) => (
          <WorkspaceGroupSection
            key={scope}
            scope={scope}
            workspaces={workspaces}
            settings={groupSettings}
            dragScope={dragScope}
            canManageGlobal={canManageGlobal}
            dragHeader={dragHeader}
            onToggle={(id) =>
              saveGroups({
                ...groupSettings,
                collapsed: {
                  ...groupSettings.collapsed,
                  [id]: !groupSettings.collapsed[id],
                },
              })
            }
            onCreate={(scope) => setGroupDialog({ mode: "create", scope })}
            onEdit={(group) =>
              setGroupDialog({ mode: "edit", scope: group.scope, group })
            }
            renderWorkspace={renderWorkspace}
          />
        ))}
        {groupDialog && (
          <WorkspaceGroupDialog
            key={`${groupDialog.mode}:${groupDialog.group?.id || groupDialog.workspace?.id || groupDialog.scope}`}
            dialog={groupDialog}
            settings={groupSettings}
            canManageGlobal={canManageGlobal}
            workspaces={workspaces}
            globalAssignments={preferences.globalGroups?.assignments || {}}
            saving={saving}
            onMove={(ids, targetId) =>
              moveGroupWorkspaces(ids, targetId, groupDialog.group)
            }
            onClose={() => setGroupDialog(null)}
            onSave={saveGroupDialog}
            onCreate={(scope, workspace) =>
              setGroupDialog({ mode: "create", scope, workspace })
            }
            onDelete={(id) => {
              const global = groupSettings.groups.some(
                (group) => group.id === id && group.global
              );
              if (
                global
                  ? !canManageGlobal ||
                    !savePreferences(
                      { type: "global-group", action: "delete", id },
                      preferences
                    )
                  : !saveGroups(removeWorkspaceGroup(groupSettings, id))
              )
                return false;
              setGroupDialog(null);
              return true;
            }}
          />
        )}
        {contextMenu && (
          <WorkspaceContextMenu
            {...contextMenu}
            onClose={() => setContextMenu(null)}
            onRename={() => startWorkspaceRename(contextMenu.workspace)}
            onGroup={() =>
              setGroupDialog({
                mode: "assign",
                workspace: contextMenu.workspace,
              })
            }
            starred={favorites.workspaces.includes(contextMenu.workspace.id)}
            onStar={() => starWorkspace(contextMenu.workspace)}
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
    </DragDropContext>
  );
}

// Desktop density uses CSS zoom; DnD positions are measured in viewport pixels.
function workspaceDragStyle(style) {
  if (style?.position !== "fixed") return style;
  const zoom = Number(getComputedStyle(document.body).zoom) || 1;
  if (zoom === 1) return style;
  const next = { ...style };
  for (const field of ["top", "left", "width", "height"])
    if (typeof next[field] === "number") next[field] /= zoom;
  next.transform = next.transform?.replace(
    /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/,
    (_, x, y) => `translate(${Number(x) / zoom}px, ${Number(y) / zoom}px)`
  );
  return next;
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
}) {
  return [
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
  onGroup,
  starred,
  onStar,
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

function WorkspaceActionsMenu({
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
