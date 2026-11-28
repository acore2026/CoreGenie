import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { Link, useMatch, useNavigate, useParams } from "react-router-dom";
import { CaretDown } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Workspace from "@/models/workspace";
import ManageWorkspace, {
  useManageWorkspaceModal,
} from "../../Modals/ManageWorkspace";
import paths from "@/utils/paths";
import useUser from "@/hooks/useUser";
import ThreadContainer, { CreateThreadButton } from "./ThreadContainer";
import { WorkspaceGroupDialog, WorkspaceGroupSection } from "./WorkspaceGroups";
import { GROUP_SCOPES, workspaceScope } from "@/utils/workspaceGroups.mjs";
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
import useWorkspaceFavorites from "@/hooks/useWorkspaceFavorites";
import { queryKeys } from "@/lib/queryKeys";
import {
  WorkspaceActionsMenu,
  WorkspaceContextMenu,
  type SidebarWorkspace,
} from "./WorkspaceMenu";
import { StarredWorkspacesSection } from "./StarredWorkspacesSection";
import { useWorkspaceGroupsState } from "./useWorkspaceGroupsState";

function DraggableWorkspaceRow({
  workspace,
  sourceGroupId,
  sourceIndex,
  disabled,
  children,
}: {
  workspace: SidebarWorkspace;
  sourceGroupId: string;
  sourceIndex: number;
  disabled: boolean;
  children: (props: {
    dragHandleProps: Record<string, unknown>;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: String(workspace.id),
      disabled,
      data: { workspace, sourceGroupId, sourceIndex },
    });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 50 : undefined,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col w-full group ${isDragging ? "opacity-50" : ""}`}
      role="listitem"
    >
      {children({
        dragHandleProps: { ...attributes, ...listeners },
        isDragging,
      })}
    </div>
  );
}

interface WorkspaceContextMenuState {
  point: { x: number; y: number };
  workspace: SidebarWorkspace;
  canParticipate: boolean;
  canManage: boolean;
}

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

function WorkspaceList({
  adminView,
  canUseAdminView,
}: {
  adminView: boolean;
  canUseAdminView: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user, authToken } = useUser();
  const { favorites, toggle: toggleFavorite } = useWorkspaceFavorites();
  const navigate = useNavigate();
  const { slug } = useParams();

  const expansionKey = `workspace-expansion:${user?.id ?? "single-user"}`;
  const owner = `${user?.id ?? "single-user"}:${authToken ?? ""}:${adminView ? "admin" : "assigned"}`;
  const listQueryKey = queryKeys.workspaces.list(owner);

  const { data: workspaces = [], isPending: loading } = useQuery<
    SidebarWorkspace[]
  >({
    queryKey: listQueryKey,
    queryFn: async () => {
      const visibleWorkspaces =
        canUseAdminView && !adminView
          ? await assignedAdminWorkspaces(user.id, { refresh: true })
          : await Workspace.all();
      return Workspace.orderWorkspaces(visibleWorkspaces) as SidebarWorkspace[];
    },
  });

  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedWs, setSelectedWs] = useState<SidebarWorkspace | null>(null);
  const [inviteWorkspace, setInviteWorkspace] =
    useState<SidebarWorkspace | null>(null);
  const [contextMenu, setContextMenu] =
    useState<WorkspaceContextMenuState | null>(null);

  const canManageGlobal = !user || user.role === "admin";
  const {
    preferences,
    groupSettings,
    ready,
    saving,
    groupDialog,
    setGroupDialog,
    dragScope,
    setDragScope,
    saveGroups,
    moveGroupWorkspaces,
    saveGroupDialog,
    deleteGroup,
    onDragEnd,
  } = useWorkspaceGroupsState({
    workspaces,
    canManageGlobal,
    onReorderWorkspaces: (reordered) => {
      queryClient.setQueryData<SidebarWorkspace[]>(
        listQueryKey,
        Workspace.orderWorkspaces(reordered) as SidebarWorkspace[]
      );
    },
  });

  const [expansion, setExpansion] = useState<Record<string, boolean>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(expansionKey) || "null");
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    } catch {
      return {};
    }
  });
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameSavingRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const { showing, showModal, hideModal } = useManageWorkspaceModal();
  const isInWorkspaceSettings = !!useMatch("/workspace/:slug/settings/:tab");
  const isHomePage = !!useMatch("/");

  function starWorkspace(workspace: SidebarWorkspace) {
    if (!toggleFavorite("workspaces", workspace.id))
      showToast(t("favorites.save_failed"), "error");
  }

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
    const workspaceCreated = (event: Event) => {
      const workspace = (event as CustomEvent<{ workspace?: SidebarWorkspace }>)
        .detail?.workspace;
      if (!workspace?.slug) return;
      queryClient.setQueryData<SidebarWorkspace[]>(
        listQueryKey,
        (current = []) =>
          Workspace.orderWorkspaces(
            current.some((item) => item.slug === workspace.slug)
              ? current
              : [...current, workspace]
          ) as SidebarWorkspace[]
      );
    };
    const workspaceRenamed = (event: Event) => {
      const { workspaceSlug, name } =
        (event as CustomEvent<{ workspaceSlug?: string; name?: string }>)
          .detail || {};
      if (!workspaceSlug || !name) return;
      queryClient.setQueryData<SidebarWorkspace[]>(
        listQueryKey,
        (current = []) =>
          Workspace.orderWorkspaces(
            current.map((item) =>
              item.slug === workspaceSlug ? { ...item, name } : item
            )
          ) as SidebarWorkspace[]
      );
    };
    window.addEventListener(WORKSPACE_CREATED_EVENT, workspaceCreated);
    window.addEventListener(WORKSPACE_RENAMED_EVENT, workspaceRenamed);
    return () => {
      window.removeEventListener(WORKSPACE_CREATED_EVENT, workspaceCreated);
      window.removeEventListener(WORKSPACE_RENAMED_EVENT, workspaceRenamed);
    };
  }, [listQueryKey, queryClient]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

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

  function startWorkspaceRename(workspace: SidebarWorkspace) {
    if (user?.role === "default") return;
    renameCancelledRef.current = false;
    setRenameValue(workspace.name);
    setRenamingSlug(workspace.slug);
  }

  function toggleWorkspace(workspaceSlug: string, isExpanded: boolean) {
    setExpansion((current) => ({ ...current, [workspaceSlug]: !isExpanded }));
  }

  function handleWorkspaceClick(
    event: MouseEvent<HTMLAnchorElement>,
    workspace: SidebarWorkspace
  ) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    window.dispatchEvent(new Event(CLOSE_MOBILE_SIDEBAR_EVENT));
    setExpansion((current) => ({ ...current, [workspace.slug]: true }));
    navigate(paths.workspace.chat(workspace.slug));
  }

  async function commitWorkspaceRename(workspace: SidebarWorkspace) {
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

  function renderWorkspace(
    workspace: SidebarWorkspace,
    index: number,
    sourceGroupId: string
  ) {
    const isVirtuallyActive = workspace.slug === virtualActiveSlug;
    const isActive = workspace.slug === slug || isVirtuallyActive;
    const isExpanded = expansion[workspace.slug] ?? isActive;
    const canParticipate = workspace.viewerAccess !== "public_readonly";
    return (
      <DraggableWorkspaceRow
        key={workspace.id}
        workspace={workspace}
        sourceGroupId={sourceGroupId}
        sourceIndex={index}
        disabled={!ready || saving || renamingSlug === workspace.slug}
      >
        {({ dragHandleProps }) => (
          <>
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
                    onBlur={() => void commitWorkspaceRename(workspace)}
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
                <Link
                  {...dragHandleProps}
                  to={paths.workspace.chat(workspace.slug)}
                  onClick={(event) => handleWorkspaceClick(event, workspace)}
                  title={workspace.name}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-10 min-w-0 flex-1 items-center py-0 pl-1 pr-[72px] text-sm text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-button md:pr-2 md:group-hover/workspace:pr-[72px] md:group-focus-within/workspace:pr-[72px] ${isActive ? "font-semibold" : "font-medium"}`}
                >
                  <span className="truncate">{workspace.name}</span>
                </Link>
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
          </>
        )}
      </DraggableWorkspaceRow>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragScope(null)}
      onDragStart={(event) => {
        const ws = workspaces.find(
          (workspace) => String(workspace.id) === String(event.active.id)
        );
        setDragScope(ws ? workspaceScope(ws) : null);
      }}
    >
      <div
        className="flex flex-col gap-y-4"
        aria-label={t("workbench_nav.workspaces")}
      >
        <StarredWorkspacesSection
          workspaces={workspaces}
          favoriteWorkspaceIds={favorites.workspaces}
          groupSettings={groupSettings}
          onWorkspaceClick={handleWorkspaceClick}
          onStarWorkspace={starWorkspace}
        />
        {GROUP_SCOPES.map((scope: string) => (
          <WorkspaceGroupSection
            key={scope}
            scope={scope}
            workspaces={workspaces}
            settings={groupSettings}
            dragScope={dragScope}
            canManageGlobal={canManageGlobal}
            onToggle={(id: string) =>
              saveGroups({
                ...groupSettings,
                collapsed: {
                  ...groupSettings.collapsed,
                  [id]: !groupSettings.collapsed[id],
                },
              })
            }
            onCreate={(targetScope: string) =>
              setGroupDialog({ mode: "create", scope: targetScope })
            }
            onEdit={(group: {
              id: string;
              scope: string;
              name: string;
              global?: boolean;
            }) => setGroupDialog({ mode: "edit", scope: group.scope, group })}
            renderWorkspace={renderWorkspace}
          />
        ))}
        {groupDialog && (
          <WorkspaceGroupDialog
            key={`${groupDialog.mode}:${groupDialog.group?.id || groupDialog.workspace?.id || groupDialog.scope}`}
            dialog={groupDialog}
            settings={groupSettings}
            canManageGlobal={canManageGlobal}
            workspaces={workspaces as never[]}
            globalAssignments={preferences.globalGroups?.assignments || {}}
            saving={saving}
            onMove={(ids: number[], targetId: string) =>
              moveGroupWorkspaces(ids, targetId, groupDialog.group)
            }
            onClose={() => setGroupDialog(null)}
            onSave={saveGroupDialog}
            onCreate={(targetScope: string, workspace: SidebarWorkspace) =>
              setGroupDialog({ mode: "create", scope: targetScope, workspace })
            }
            onDelete={deleteGroup}
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
            providedSlug={(selectedWs ? selectedWs.slug : null) as never}
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
    </DndContext>
  );
}
