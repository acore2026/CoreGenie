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
import { WORKSPACE_CREATED_EVENT, WORKSPACE_RENAMED_EVENT } from "../events";
import WorkspaceInviteModal from "@/components/Modals/WorkspaceInvite";

let cachedWorkspaces = null;

export default function ActiveWorkspaces() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [loading, setLoading] = useState(() => cachedWorkspaces === null);
  const [workspaces, setWorkspaces] = useState(() => cachedWorkspaces || []);
  const [renamingSlug, setRenamingSlug] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedWs, setSelectedWs] = useState(null);
  const [inviteWorkspace, setInviteWorkspace] = useState(null);
  const renameInputRef = useRef(null);
  const renameSavingRef = useRef(false);
  const renameCancelledRef = useRef(false);
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
                            onClick={(event) => {
                              if (!isActive) return;
                              event.preventDefault();
                              startWorkspaceRename(workspace);
                            }}
                            aria-current={isActive ? "page" : ""}
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
                              <div
                                className={`flex items-center gap-x-[2px] transition-opacity duration-200 ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                              >
                                {user && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setInviteWorkspace(workspace);
                                    }}
                                    aria-label={t("workspace-invite.action")}
                                    data-tooltip-id="invite-workspace"
                                    data-tooltip-content={t(
                                      "workspace-invite.action"
                                    )}
                                    className={`group/invite border-none rounded-md flex items-center justify-center ml-auto p-[2px] ${isActive ? "hover:bg-zinc-500 light:hover:bg-sky-800/30" : "hover:bg-zinc-500 light:hover:bg-slate-400"}`}
                                  >
                                    <UserPlus
                                      weight="bold"
                                      className={`h-[20px] w-[20px] ${isActive ? "text-zinc-400 hover:text-white light:text-blue-700 light:group-hover/invite:text-blue-900" : "text-zinc-400 hover:text-white light:text-slate-600 light:group-hover/invite:text-slate-950"}`}
                                    />
                                  </button>
                                )}
                                {user?.role !== "default" && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setSelectedWs(workspace);
                                        showModal();
                                      }}
                                      aria-label={t(
                                        "workspace-invite.import-documents"
                                      )}
                                      data-tooltip-id="upload-workspace"
                                      data-tooltip-content={t(
                                        "workspace-invite.import-documents"
                                      )}
                                      className={`group/upload border-none rounded-md flex items-center justify-center ml-auto p-[2px] ${isActive ? "hover:bg-zinc-500 light:hover:bg-sky-800/30" : "hover:bg-zinc-500 light:hover:bg-slate-400"}`}
                                    >
                                      <FilePlus
                                        weight="bold"
                                        className={`h-[20px] w-[20px] ${isActive ? "text-zinc-400 hover:text-white light:text-blue-700 light:group-hover/upload:text-blue-900" : "text-zinc-400 hover:text-white light:text-slate-600 light:group-hover/upload:text-slate-950"}`}
                                      />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        navigate(
                                          isInWorkspaceSettings
                                            ? paths.workspace.chat(
                                                workspace.slug
                                              )
                                            : paths.workspace.settings.generalAppearance(
                                                workspace.slug
                                              )
                                        );
                                      }}
                                      className={`group/gear rounded-md flex items-center justify-center ml-auto p-[2px] ${isActive ? "hover:bg-zinc-500 light:hover:bg-sky-800/30" : "hover:bg-zinc-500 light:hover:bg-slate-400"}`}
                                      aria-label="General appearance settings"
                                      data-tooltip-id="gear-workspace"
                                      data-tooltip-content="General appearance settings"
                                    >
                                      <GearSix
                                        color={
                                          isInWorkspaceSettings &&
                                          workspace.slug === slug
                                            ? "#46C8FF"
                                            : undefined
                                        }
                                        className={`h-[20px] w-[20px] ${isActive ? "text-zinc-400 hover:text-white light:text-blue-700 light:group-hover/gear:text-blue-900" : "text-zinc-400 hover:text-white light:text-slate-600 light:group-hover/gear:text-slate-950"}`}
                                      />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </Link>
                        )}
                      </div>
                      {isActive && <ThreadContainer workspace={workspace} />}
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
