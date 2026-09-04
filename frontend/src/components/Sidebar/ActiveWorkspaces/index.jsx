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
  DotsSixVertical,
  FilePlus,
  GearSix,
  UserPlus,
} from "@phosphor-icons/react";
import useUser from "@/hooks/useUser";
import { useTranslation } from "react-i18next";
import ThreadContainer from "./ThreadContainer";
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

let cachedWorkspaces = null;

export default function ActiveWorkspaces() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const [loading, setLoading] = useState(() => cachedWorkspaces === null);
  const [workspaces, setWorkspaces] = useState(() => cachedWorkspaces || []);
  const [renamingSlug, setRenamingSlug] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedWs, setSelectedWs] = useState(null);
  const [inviteWorkspace, setInviteWorkspace] = useState(null);
  const [collapsedSlugs, setCollapsedSlugs] = useState(() => new Set());
  const renameInputRef = useRef(null);
  const renameSavingRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const workspaceClickTimerRef = useRef(null);
  const { showing, showModal, hideModal } = useManageWorkspaceModal();
  const { user } = useUser();
  const isInWorkspaceSettings = !!useMatch("/workspace/:slug/settings/:tab");
  const isHomePage = !!useMatch("/");

  useEffect(() => {
    async function getWorkspaces() {
      const workspaces = Workspace.orderWorkspaces(await Workspace.all());
      cachedWorkspaces = workspaces;
      setLoading(false);
      setWorkspaces(workspaces);
    }
    getWorkspaces();
  }, []);

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

  useEffect(
    () => () => {
      if (workspaceClickTimerRef.current)
        clearTimeout(workspaceClickTimerRef.current);
    },
    []
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
      showToast("Failed to reorder workspaces", "error");
      Workspace.all().then((workspaces) => {
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

  function toggleWorkspace(workspaceSlug) {
    setCollapsedSlugs((current) => {
      const next = new Set(current);
      if (next.has(workspaceSlug)) next.delete(workspaceSlug);
      else next.add(workspaceSlug);
      return next;
    });
  }

  function handleWorkspaceClick(event, workspace, isActive) {
    event.preventDefault();
    window.dispatchEvent(new Event(CLOSE_MOBILE_SIDEBAR_EVENT));
    if (workspaceClickTimerRef.current)
      clearTimeout(workspaceClickTimerRef.current);
    workspaceClickTimerRef.current = setTimeout(() => {
      workspaceClickTimerRef.current = null;
      if (isActive) {
        toggleWorkspace(workspace.slug);
        return;
      }
      setCollapsedSlugs((current) => {
        const next = new Set(current);
        next.delete(workspace.slug);
        return next;
      });
      navigate(paths.workspace.chat(workspace.slug));
    }, 180);
  }

  function handleWorkspaceDoubleClick(event, workspace) {
    event.preventDefault();
    event.stopPropagation();
    if (workspaceClickTimerRef.current) {
      clearTimeout(workspaceClickTimerRef.current);
      workspaceClickTimerRef.current = null;
    }
    startWorkspaceRename(workspace);
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
      showToast(`Workspace could not be renamed! ${message || ""}`, "error", {
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
            aria-label="Workspaces"
            className="flex flex-col gap-y-2"
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {workspaces.map((workspace, index) => {
              const isVirtuallyActive = workspace.slug === virtualActiveSlug;
              const isActive = workspace.slug === slug || isVirtuallyActive;
              const isExpanded =
                isActive && !collapsedSlugs.has(workspace.slug);
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
                      <div className="flex gap-x-2 items-center justify-between">
                        {renamingSlug === workspace.slug ? (
                          <div
                            className={`
                            flex flex-grow w-[75%] gap-x-2 py-[5px] pl-[7px] pr-[6px] rounded-[4px] items-center
                            bg-theme-sidebar-item-default light:bg-blue-200
                          `}
                          >
                            <DotsSixVertical
                              size={20}
                              className="mr-[3px] text-white light:text-blue-800"
                              weight="bold"
                            />
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
                              aria-label="Rename workspace"
                              className="h-7 min-w-0 flex-1 rounded-md border border-sky-400/70 bg-zinc-950 light:bg-white px-2 text-sm font-semibold text-white light:text-slate-900 outline-none ring-2 ring-sky-400/15"
                            />
                          </div>
                        ) : (
                          <Link
                            to={paths.workspace.chat(workspace.slug)}
                            onClick={(event) =>
                              handleWorkspaceClick(event, workspace, isActive)
                            }
                            aria-current={isActive ? "page" : ""}
                            aria-expanded={isActive ? isExpanded : undefined}
                            className={`
                            transition-all duration-[200ms]
                            flex flex-grow w-[75%] gap-x-2 py-[6px] pl-[4px] pr-[6px] rounded-[4px] text-white justify-start items-center
                            bg-theme-sidebar-item-default
                            ${isActive ? "light:bg-blue-200 font-bold" : "hover:bg-theme-sidebar-subitem-hover light:hover:bg-slate-300"}
                          `}
                          >
                            <div className="flex flex-row justify-between w-full items-center">
                              <div
                                {...provided.dragHandleProps}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                className="cursor-grab mr-[3px]"
                              >
                                <DotsSixVertical
                                  size={20}
                                  className={`${isActive ? "text-white light:text-blue-800" : ""}`}
                                  weight="bold"
                                />
                              </div>
                              <div
                                data-tooltip-id="workspace-name"
                                data-tooltip-content={workspace.name}
                                onDoubleClick={(event) =>
                                  handleWorkspaceDoubleClick(event, workspace)
                                }
                                className="flex items-center space-x-2 overflow-hidden flex-grow"
                              >
                                <div className="w-[130px] overflow-hidden">
                                  <p
                                    className={`
                                  text-[14px] leading-loose whitespace-nowrap overflow-hidden
                                  ${isActive ? "font-bold text-white light:text-blue-900" : "font-medium "} truncate
                                  w-full group-hover:w-[130px] group-hover:duration-200
                                `}
                                  >
                                    {workspace.name}
                                  </p>
                                </div>
                              </div>
                              <CaretDown
                                size={14}
                                aria-hidden="true"
                                className={`shrink-0 text-zinc-500 transition-transform duration-150 light:text-slate-500 ${isExpanded ? "rotate-0" : "-rotate-90"}`}
                              />
                            </div>
                          </Link>
                        )}
                        {renamingSlug !== workspace.slug && (
                          <WorkspaceActionsMenu
                            workspace={workspace}
                            isActive={isActive}
                            isInWorkspaceSettings={isInWorkspaceSettings}
                            canParticipate={canParticipate}
                            canManage={user?.role !== "default"}
                            onInvite={() => setInviteWorkspace(workspace)}
                            onOpenFiles={() => {
                              setSelectedWs(workspace);
                              showModal();
                            }}
                          />
                        )}
                      </div>
                      {isExpanded && (
                        <ThreadContainer
                          workspace={workspace}
                          canCreate={canParticipate}
                        />
                      )}
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
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

function WorkspaceActionsMenu({
  workspace,
  isActive,
  isInWorkspaceSettings,
  canParticipate,
  canManage,
  onInvite,
  onOpenFiles,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const runAction = (action) => {
    setOpen(false);
    action();
  };

  const actions = [
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

  if (actions.length === 0) return null;

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
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
        className={`flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-theme-sidebar-item-default text-zinc-400 transition-[background-color,border-color,color,transform] duration-150 hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 light:border-slate-300 light:text-slate-600 light:hover:border-cyan-500/35 light:hover:bg-cyan-50 light:hover:text-cyan-800 ${open || (isActive && isInWorkspaceSettings) ? "border-cyan-300/20 text-cyan-300 light:border-cyan-500/25 light:text-cyan-700" : ""}`}
      >
        <GearSix size={18} weight={open ? "fill" : "regular"} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("sidebar-workspace-menu.title")}
          className="absolute right-0 top-9 z-[70] w-[190px] rounded-lg border border-white/10 bg-zinc-900 p-1.5 light:border-slate-300 light:bg-white"
        >
          {actions.map(({ key, label, icon: Icon, action }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => runAction(action)}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium text-zinc-200 transition-[background-color,color] duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/50 light:text-slate-700 light:hover:bg-slate-100 light:hover:text-slate-950"
            >
              <Icon size={17} weight="bold" className="shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
