import { useState } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { v4 as uuidv4 } from "uuid";
import {
  GROUP_SCOPES,
  assignWorkspaceGroups,
  effectiveWorkspaceGroups,
  groupDropDestination,
  moveGroupedWorkspace,
  personalWorkspaceGroups,
  removeWorkspaceGroup,
  workspaceGroupId,
} from "@/utils/workspaceGroups.ts";
import useSidebarPreferences from "@/hooks/useSidebarPreferences";
import type { SidebarWorkspace } from "./WorkspaceMenu";

import type { WorkspaceGroup } from "@/utils/workspaceGroups";
export type { WorkspaceGroup } from "@/utils/workspaceGroups";

export interface GroupDialogState {
  mode: "assign" | "create" | "edit";
  scope?: string;
  group?: WorkspaceGroup;
  workspace?: SidebarWorkspace;
}

interface UseWorkspaceGroupsStateArgs {
  workspaces: SidebarWorkspace[];
  canManageGlobal: boolean;
  onReorderWorkspaces: (workspaces: SidebarWorkspace[]) => void;
}

export function useWorkspaceGroupsState({
  workspaces,
  canManageGlobal,
  onReorderWorkspaces,
}: UseWorkspaceGroupsStateArgs) {
  const {
    preferences,
    save: savePreferences,
    ready,
    saving,
  } = useSidebarPreferences();
  const groupSettings = effectiveWorkspaceGroups(
    preferences.groups,
    preferences.globalGroups
  );
  const [groupDialog, setGroupDialog] = useState<GroupDialogState | null>(null);
  const [dragScope, setDragScope] = useState<string | null>(null);

  function saveGroups(next: typeof groupSettings) {
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

  function moveGroupWorkspaces(
    ids: number[],
    targetId: string,
    sourceGroup?: WorkspaceGroup
  ) {
    const sourceSettings = sourceGroup?.global
      ? {
          ...groupSettings,
          assignments: preferences.globalGroups?.assignments || {},
        }
      : groupSettings;
    if (
      sourceGroup &&
      ids.some((id) => {
        const workspace = workspaces.find((item) => item.id === id);
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
        (group: WorkspaceGroup) => group.id === targetId
      );
      if (target && !target.global) return false;
      const assignments = { ...preferences.groups.assignments };
      for (const id of ids) {
        if (assignments[id] === sourceGroup.id) delete assignments[id];
      }
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

  function saveGroupDialog(value: string, global?: boolean) {
    if (!groupDialog) return false;
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
    if (groupDialog.mode === "assign" && groupDialog.workspace) {
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
        groups: next.groups.map((group: WorkspaceGroup) =>
          group.id === groupDialog.group?.id ? { ...group, name: value } : group
        ),
      };
    } else {
      const group = {
        id: `group-${uuidv4()}`,
        scope: groupDialog.scope ?? "private",
        name: value,
      };
      next = {
        ...next,
        groups: [...next.groups, group],
        collapsed: { ...next.collapsed, [group.scope || ""]: false },
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

  function deleteGroup(id: string) {
    const isGlobal = groupSettings.groups.some(
      (group: WorkspaceGroup) => group.id === id && group.global
    );
    if (
      isGlobal
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
  }

  function onDragEnd(event: DragEndEvent) {
    setDragScope(null);
    if (!event.over) return;
    const activeData = event.active.data.current as
      { sourceGroupId?: string; sourceIndex?: number } | undefined;
    const sourceDroppableId = activeData?.sourceGroupId;
    const sourceIndex = activeData?.sourceIndex ?? 0;
    if (!sourceDroppableId) return;

    const destination = groupDropDestination({
      droppableId: String(event.over.id),
      index: 0,
    });
    if (!destination) return;
    if (sourceDroppableId === destination.droppableId) return;
    const sourceGroup = groupSettings.groups.find(
      (group: WorkspaceGroup) => group.id === sourceDroppableId
    );
    const targetGroup = groupSettings.groups.find(
      (group: WorkspaceGroup) => group.id === destination.droppableId
    );
    const moving = workspaces.filter(
      (workspace) =>
        workspaceGroupId(workspace, groupSettings) === sourceDroppableId
    )[sourceIndex];
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
      { droppableId: sourceDroppableId, index: sourceIndex },
      destination
    );
    if (!next || !saveGroups(next.settings)) return;
    onReorderWorkspaces(next.workspaces);
  }

  return {
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
  };
}
