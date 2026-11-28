import { useEffect, useId, useRef, useState } from "react";
import { RadioGroup, Listbox } from "@headlessui/react";
import {
  Minus,
  Check,
  FolderSimple,
  FolderPlus,
  Plus,
  PencilSimple,
  X,
  CaretDown,
  MagnifyingGlass,
  ArrowRight,
} from "@phosphor-icons/react";
import { useDroppable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import {
  workspaceGroupId,
  workspaceScope,
  groupDropTargetId,
} from "@/utils/workspaceGroups.ts";

import type { TFunction } from "i18next";
import type { GroupSettings, WorkspaceGroup } from "@/utils/workspaceGroups";
import type { SidebarWorkspace } from "./WorkspaceMenu";
import type { GroupDialogState } from "./useWorkspaceGroupsState";
type RenderWorkspace = (
  workspace: SidebarWorkspace,
  index: number,
  sourceGroupId: string
) => React.ReactNode;
interface GroupMoverProps {
  group: WorkspaceGroup;
  settings: GroupSettings;
  workspaces: SidebarWorkspace[];
  globalAssignments: Record<string, string>;
  onMove: (ids: number[], target: string) => boolean;
  saving: boolean;
}
const iconButton =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50";

function GroupDropHeader({
  id,
  scope,
  disabled,
  children,
}: React.PropsWithChildren<{ id: string; scope: string; disabled: boolean }>) {
  const { setNodeRef, isOver } = useDroppable({
    id: groupDropTargetId(id),
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      data-workspace-group-drop-target={id}
      data-workspace-group-drop-scope={scope}
      className={`rounded-md ${isOver ? "bg-theme-sidebar-subitem-hover ring-2 ring-inset ring-primary-button" : ""}`}
    >
      {children}
    </div>
  );
}

function GroupDropList({
  id,
  scope,
  disabled,
  entries,
  groups,
  renderWorkspace,
  t,
}: {
  id: string;
  scope: string;
  disabled: boolean;
  entries: SidebarWorkspace[];
  groups: WorkspaceGroup[];
  renderWorkspace: RenderWorkspace;
  t: TFunction;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      role="list"
      aria-label={
        id === scope
          ? t("workspace_groups.ungrouped")
          : groups.find((group) => group.id === id)?.name
      }
      className={`min-h-3 rounded-md ${isOver ? "bg-theme-sidebar-subitem-hover" : ""}`}
    >
      {entries.map((entry, index) => renderWorkspace(entry, index, id))}
      {!entries.length && (id !== scope || groups.length === 0) && (
        <p className="px-3 py-2 text-xs text-theme-text-secondary">
          {t("workspace_groups.empty")}
        </p>
      )}
    </div>
  );
}

// The permission heading remains visible while its nested workspace groups fold.
export function WorkspaceGroupSection({
  scope,
  workspaces,
  settings,
  onToggle,
  onCreate,
  onEdit,
  renderWorkspace,
  dragScope,
  canManageGlobal,
}: {
  scope: string;
  workspaces: SidebarWorkspace[];
  settings: GroupSettings;
  onToggle: (id: string) => void;
  onCreate: (scope: string) => void;
  onEdit: (group: WorkspaceGroup) => void;
  renderWorkspace: RenderWorkspace;
  dragScope: string | null;
  canManageGlobal: boolean;
}) {
  const { t } = useTranslation();
  const groups = settings.groups.filter((group) => group.scope === scope);
  const rows = workspaces.filter(
    (workspace) => workspaceScope(workspace) === scope
  );
  const collapsed = settings.collapsed[scope] === true;
  const dropDisabled = Boolean(dragScope && dragScope !== scope);
  function dropHeader(id: string, children: React.ReactNode) {
    return (
      <GroupDropHeader id={id} scope={scope} disabled={dropDisabled}>
        {children}
      </GroupDropHeader>
    );
  }
  const renderList = (id: string) => {
    const entries = rows.filter(
      (workspace) => workspaceGroupId(workspace, settings) === id
    );
    return (
      <GroupDropList
        id={id}
        scope={scope}
        disabled={dropDisabled}
        entries={entries}
        groups={groups}
        renderWorkspace={renderWorkspace}
        t={t}
      />
    );
  };
  return (
    <section aria-label={t(`workspace_groups.${scope}`)} className="min-w-0">
      {dropHeader(
        scope,
        <div className="group/workspace-group mb-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggle(scope)}
            aria-expanded={!collapsed}
            aria-controls={`workspace-section-${scope}`}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-xs font-semibold text-theme-text-secondary hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
          >
            <span>{t(`workspace_groups.${scope}`)}</span>
            <span className="font-mono text-[11px] font-normal tabular-nums">
              {rows.length}
            </span>
            <span
              aria-hidden="true"
              className="h-px min-w-2 flex-1 bg-theme-sidebar-border"
            />
            {collapsed ? <Plus size={12} /> : <Minus size={12} />}
          </button>
          <button
            type="button"
            className={`${iconButton} md:opacity-0 md:group-hover/workspace-group:opacity-100 md:group-focus-within/workspace-group:opacity-100`}
            onClick={() => onCreate(scope)}
            title={t("workspace_groups.create_in", {
              scope: t(`workspace_groups.${scope}`),
            })}
            aria-label={t("workspace_groups.create_in", {
              scope: t(`workspace_groups.${scope}`),
            })}
          >
            <FolderPlus size={16} />
          </button>
        </div>
      )}
      <div id={`workspace-section-${scope}`} hidden={collapsed}>
        {groups.map((group) => {
          const closed = settings.collapsed[group.id] === true;
          const count = rows.filter(
            (workspace) => workspaceGroupId(workspace, settings) === group.id
          ).length;
          return (
            <div key={group.id} className="mb-2">
              {dropHeader(
                group.id,
                <div className="group/workspace-group flex items-center">
                  <button
                    type="button"
                    onClick={() => onToggle(group.id)}
                    aria-expanded={!closed}
                    aria-controls={`workspace-section-${group.id}`}
                    title={group.name}
                    className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md pl-3 pr-2 text-xs font-medium text-theme-text-secondary hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
                  >
                    <span className="truncate">{group.name}</span>
                    <span className="font-mono text-[10px] font-normal tabular-nums text-theme-text-secondary">
                      {count}
                    </span>
                    <span aria-hidden="true" className="min-w-2 flex-1" />
                    {closed ? (
                      <Plus size={12} className="shrink-0" />
                    ) : (
                      <Minus size={12} className="shrink-0" />
                    )}
                  </button>
                  {(!group.global || canManageGlobal) && (
                    <button
                      type="button"
                      className={`${iconButton} md:opacity-0 md:group-hover/workspace-group:opacity-100 md:group-focus-within/workspace-group:opacity-100`}
                      onClick={() => onEdit(group)}
                      aria-label={t("workspace_groups.edit_named", {
                        name: group.name,
                      })}
                    >
                      <PencilSimple size={14} />
                    </button>
                  )}
                </div>
              )}
              <div id={`workspace-section-${group.id}`} hidden={closed}>
                {renderList(group.id)}
              </div>
            </div>
          );
        })}
        {groups.length > 0 &&
          (dragScope === scope ||
            rows.some(
              (workspace) => workspaceGroupId(workspace, settings) === scope
            )) && (
            <div className="px-3 pb-1 pt-3 text-[11px] text-theme-text-secondary">
              {t("workspace_groups.ungrouped")}
            </div>
          )}
        {renderList(scope)}
      </div>
    </section>
  );
}

export function WorkspaceGroupDialog({
  dialog,
  settings,
  onClose,
  onSave,
  onDelete,
  onCreate,
  canManageGlobal,
  workspaces = [],
  globalAssignments = {},
  onMove,
  saving = false,
}: Pick<GroupMoverProps, "settings" | "onMove"> &
  Partial<
    Pick<GroupMoverProps, "workspaces" | "globalAssignments" | "saving">
  > & {
    dialog: GroupDialogState;
    onClose: () => void;
    onSave: (value: string, global: boolean) => boolean;
    onDelete: (id: string) => boolean;
    onCreate: (scope: string, workspace: SidebarWorkspace) => void;
    canManageGlobal: boolean;
  }) {
  const { t } = useTranslation();
  const assigning = dialog.mode === "assign" && dialog.workspace;
  const scope = dialog.scope || workspaceScope(dialog.workspace ?? {});
  const [name, setName] = useState(dialog.group?.name || "");
  const [selected, setSelected] = useState(
    assigning ? workspaceGroupId(assigning, settings) : scope
  );
  const [deleting, setDeleting] = useState(false);
  const [global, setGlobal] = useState(!!dialog.group?.global);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialogRef.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    nameRef.current?.focus();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  const groups = settings.groups.filter((group) => group.scope === scope);
  const validName = name.trim();
  const duplicate = groups.some(
    (group) =>
      group.id !== dialog.group?.id &&
      group.name.toLocaleLowerCase() === validName.toLocaleLowerCase()
  );
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assigning && (!validName || duplicate)) return;
    if (!onSave(assigning ? selected : validName, !assigning && global))
      setError(t("workspace_groups.save_failed"));
  }
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(416px,100vw)] max-w-full overflow-y-auto border-0 bg-transparent p-4 text-theme-text-primary backdrop:bg-black/50"
    >
      <div className="dsh-dialog w-full p-5">
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="text-base font-semibold text-theme-text-primary"
          >
            {t(
              `workspace_groups.${assigning ? "assign" : dialog.group ? "edit" : "create"}`
            )}
          </h2>
          <button
            type="button"
            className={iconButton}
            aria-label={t("workspace_groups.close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p
          id={descriptionId}
          className="mt-1 text-xs leading-5 text-theme-text-secondary"
        >
          {t(
            global
              ? "workspace_groups.global_hint"
              : "workspace_groups.personal_hint"
          )}
        </p>
        <form onSubmit={save} className="mt-4">
          {assigning ? (
            <>
              <p
                className="mb-3 truncate text-sm font-medium text-theme-text-primary"
                title={assigning.name}
              >
                {assigning.name}
              </p>
              <RadioGroup value={selected} onChange={setSelected}>
                <RadioGroup.Label className="mb-2 block text-xs text-theme-text-secondary">
                  {t(`workspace_groups.${scope}`)}
                </RadioGroup.Label>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {[
                    { id: scope, name: t("workspace_groups.ungrouped") },
                    ...groups,
                  ].map((group) => (
                    <RadioGroup.Option
                      key={group.id}
                      value={group.id}
                      className={({ active, checked }) =>
                        `flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-theme-text-primary hover:bg-theme-sidebar-subitem-hover ${checked ? "bg-theme-sidebar-subitem-selected" : ""} ${active ? "outline-none ring-2 ring-inset ring-primary-button" : ""}`
                      }
                    >
                      {({ checked }) => (
                        <>
                          <FolderSimple
                            size={16}
                            className="shrink-0 text-theme-text-secondary"
                          />
                          <RadioGroup.Label
                            as="span"
                            className="min-w-0 flex-1 break-words"
                          >
                            {group.name}
                          </RadioGroup.Label>
                          {checked && <Check size={16} className="shrink-0" />}
                        </>
                      )}
                    </RadioGroup.Option>
                  ))}
                </div>
              </RadioGroup>
              <button
                type="button"
                onClick={() => onCreate(scope, assigning)}
                className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
              >
                <Plus size={16} />
                {t("workspace_groups.create_and_assign")}
              </button>
            </>
          ) : (
            <>
              <label
                className="block text-xs text-theme-text-secondary"
                htmlFor="workspace-group-name"
              >
                {t("workspace_groups.name")}
              </label>
              <input
                id="workspace-group-name"
                ref={nameRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={40}
                disabled={saving}
                autoComplete="off"
                placeholder={t("workspace_groups.placeholder")}
                className="dsh-control mt-2 h-10 w-full bg-theme-bg-chat px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-primary-button"
                aria-invalid={duplicate}
                aria-describedby={
                  duplicate ? "workspace-group-error" : undefined
                }
              />
              <p className="mt-2 text-xs text-theme-text-secondary">
                {t("workspace_groups.belongs_to", {
                  scope: t(`workspace_groups.${scope}`),
                })}
              </p>
              {!dialog.group && canManageGlobal && (
                <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-theme-text-primary hover:bg-theme-sidebar-subitem-hover focus-within:ring-2 focus-within:ring-primary-button">
                  <input
                    type="checkbox"
                    checked={global}
                    onChange={(event) => setGlobal(event.target.checked)}
                    className="h-4 w-4 accent-[var(--theme-button-primary)]"
                  />
                  {t("workspace_groups.global_checkbox")}
                </label>
              )}
              {duplicate && (
                <p
                  id="workspace-group-error"
                  role="alert"
                  className="mt-2 text-xs text-theme-text-secondary"
                >
                  {t("workspace_groups.duplicate")}
                </p>
              )}
            </>
          )}
          {dialog.group && (
            <GroupWorkspaceMover
              group={dialog.group}
              settings={settings}
              workspaces={workspaces}
              globalAssignments={globalAssignments}
              onMove={onMove}
              saving={saving}
            />
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-theme-text-secondary">
              {error}
            </p>
          )}
          {deleting && (
            <p className="mt-4 text-sm leading-6 text-theme-text-secondary">
              {t("workspace_groups.delete_hint")}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {dialog.group && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (!deleting) setDeleting(true);
                  else if (dialog.group && !onDelete(dialog.group.id))
                    setError(t("workspace_groups.save_failed"));
                }}
                className="mr-auto min-h-10 rounded-md px-2 text-xs text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-40"
              >
                {t(
                  deleting
                    ? "workspace_groups.confirm_delete"
                    : "workspace_groups.delete"
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="dsh-control min-h-10 px-4 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
            >
              {t("workspace_groups.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || (!assigning && (!validName || duplicate))}
              className="min-h-10 rounded-md bg-primary-button px-4 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("workspace_groups.save")}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function GroupWorkspaceMover({
  group,
  settings,
  workspaces,
  globalAssignments,
  onMove,
  saving,
}: GroupMoverProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [targetId, setTargetId] = useState(group.scope);
  const [error, setError] = useState(false);
  const current = group.global
    ? { ...settings, assignments: globalAssignments }
    : settings;
  const members = workspaces.filter(
    (workspace) => workspaceGroupId(workspace, current) === group.id
  );
  const filtered = members.filter((workspace) =>
    workspace.name
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  );
  const ids = selected.filter((id) =>
    members.some((workspace) => workspace.id === id)
  );
  const targets = [
    { id: group.scope, name: t("workspace_groups.ungrouped") },
    ...settings.groups.filter(
      (target) =>
        target.scope === group.scope &&
        target.id !== group.id &&
        (!group.global || target.global)
    ),
  ];
  const target = targets.find((item) => item.id === targetId) || targets[0];
  return (
    <section
      className="mt-5 border-t border-theme-sidebar-border pt-4"
      aria-label={t("workspace_groups.quick_move")}
    >
      <h3 className="text-sm font-medium text-theme-text-primary">
        {t("workspace_groups.quick_move")}
      </h3>
      <p className="mt-1 text-xs leading-5 text-theme-text-secondary">
        {t(
          group.global
            ? "workspace_groups.move_global_hint"
            : "workspace_groups.move_personal_hint"
        )}
      </p>
      {!members.length ? (
        <p className="mt-3 text-xs text-theme-text-secondary">
          {t("workspace_groups.move_empty")}
        </p>
      ) : (
        <>
          <div className="relative mt-3">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-3 text-theme-text-secondary"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t("workspace_groups.move_search")}
              placeholder={t("workspace_groups.move_search")}
              className="dsh-control h-10 w-full pl-9 pr-3 text-sm text-theme-text-primary"
              disabled={saving}
            />
          </div>
          <div className="mt-2 flex min-h-10 items-center justify-between gap-2">
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md pr-2 text-xs text-theme-text-secondary focus-within:ring-2 focus-within:ring-primary-button">
              <input
                type="checkbox"
                checked={
                  filtered.length > 0 &&
                  filtered.every((workspace) => ids.includes(workspace.id))
                }
                disabled={saving || !filtered.length}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? filtered.slice(0, 100).map((workspace) => workspace.id)
                      : []
                  )
                }
                className="h-4 w-4 accent-[var(--theme-button-primary)]"
              />
              {t("workspace_groups.move_select_all")}
            </label>
            <span className="text-xs tabular-nums text-theme-text-secondary">
              {t("workspace_groups.move_selected", { count: ids.length })}
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-theme-sidebar-border p-1">
            {filtered.map((workspace) => (
              <label
                key={workspace.id}
                className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-theme-text-primary hover:bg-theme-sidebar-subitem-hover focus-within:ring-2 focus-within:ring-primary-button"
              >
                <input
                  type="checkbox"
                  checked={ids.includes(workspace.id)}
                  disabled={
                    saving || (!ids.includes(workspace.id) && ids.length >= 100)
                  }
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...ids, workspace.id]
                        : ids.filter((id) => id !== workspace.id)
                    )
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--theme-button-primary)] disabled:opacity-50"
                />
                <span className="truncate" title={workspace.name}>
                  {workspace.name}
                </span>
              </label>
            ))}
            {!filtered.length && (
              <p className="px-2 py-3 text-xs text-theme-text-secondary">
                {t("workspace_groups.move_no_match")}
              </p>
            )}
          </div>
          {ids.length >= 100 && (
            <p className="mt-2 text-xs text-theme-text-secondary">
              {t("workspace_groups.move_limit")}
            </p>
          )}
          <Listbox value={target.id} onChange={setTargetId} disabled={saving}>
            <Listbox.Label className="mb-2 mt-3 block text-xs text-theme-text-secondary">
              {t("workspace_groups.move_target")}
            </Listbox.Label>
            <div className="relative">
              <Listbox.Button className="dsh-control flex h-10 w-full items-center gap-2 px-3 text-sm text-theme-text-primary disabled:opacity-50">
                <FolderSimple size={16} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {target.name}
                </span>
                <CaretDown size={14} />
              </Listbox.Button>
              <Listbox.Options className="absolute bottom-full z-10 mb-1 max-h-40 w-full overflow-y-auto rounded-md border border-theme-sidebar-border bg-theme-bg-secondary p-1 text-sm focus:outline-none">
                {targets.map((item) => (
                  <Listbox.Option
                    key={item.id}
                    value={item.id}
                    className={({ active }) =>
                      `flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-theme-text-primary ${active ? "bg-theme-sidebar-subitem-hover" : ""}`
                    }
                  >
                    {({ selected }) => (
                      <>
                        <span className="min-w-0 flex-1 truncate">
                          {item.name}
                        </span>
                        {selected && <Check size={14} />}
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          </Listbox>
          <button
            type="button"
            disabled={saving || !ids.length}
            onClick={() => {
              if (!onMove(ids, target.id)) setError(true);
              else {
                setSelected([]);
                setError(false);
              }
            }}
            className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-theme-sidebar-border px-3 text-sm font-medium text-theme-text-primary hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowRight size={16} />
            {t(
              saving
                ? "workspace_groups.moving"
                : "workspace_groups.move_action"
            )}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-xs text-theme-text-secondary">
              {t("workspace_groups.move_failed")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
