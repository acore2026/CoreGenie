import { useEffect, useState } from "react";
import { Dialog, Listbox } from "@headlessui/react";
import {
  Buildings,
  CaretDown,
  Check,
  CircleNotch,
  Eye,
  FolderSimple,
  LockKey,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import Workspace, { type WorkspaceMember } from "@/models/workspace";
import paths from "@/utils/paths";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import useUser from "@/hooks/useUser";
import useSidebarPreferences from "@/hooks/useSidebarPreferences";
import { WORKSPACE_CREATED_EVENT } from "@/components/Sidebar/events";
import { effectiveWorkspaceGroups } from "@/utils/workspaceGroups.ts";

const noop = () => {};
const accessOptions = [
  { value: "private", icon: LockKey },
  { value: "public_readonly", icon: Eye },
  { value: "public_collaborative", icon: Buildings },
];
const secondaryButton =
  "inline-flex h-10 items-center justify-center rounded-md px-3 text-sm text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-50";

export default function NewWorkspaceModal({
  hideModal = noop,
}: {
  hideModal?: () => void;
}) {
  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState("private");
  const [users, setUsers] = useState<WorkspaceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const [reloadMembers, setReloadMembers] = useState(0);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupGlobal, setGroupGlobal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { user } = useUser();
  const { preferences, ready, refresh } = useSidebarPreferences();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scope = accessMode === "private" ? "private" : "public";
  const canManageGlobal = !user || user.role === "admin";
  const groups = effectiveWorkspaceGroups(
    preferences.groups,
    preferences.globalGroups
  ).groups.filter((group) => group.scope === scope);
  const groupOptions = [
    { id: "", name: t("workspace_groups.ungrouped"), global: false },
    ...groups,
    { id: "new", name: t("new-workspace.group_new"), global: false },
  ];
  const selectedGroup =
    groupOptions.find((group) => group.id === groupId) || groupOptions[0];
  const newGroup = groupId === "new";
  const duplicateGroup =
    newGroup &&
    groups.some(
      (group) =>
        group.name.toLocaleLowerCase() === groupName.trim().toLocaleLowerCase()
    );
  const filteredUsers = users.filter((member) =>
    [member.displayName, member.username, member.employeeNumber].some((value) =>
      value?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    )
  );

  useEffect(() => {
    if (!user?.id || accessMode !== "private") return;
    let active = true;
    setMembersLoading(true);
    setMembersError(false);
    Workspace.creationMembers()
      .then((members) => {
        if (active) setUsers(members);
      })
      .catch(() => {
        if (active) setMembersError(true);
      })
      .finally(() => {
        if (active) setMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id, reloadMembers, accessMode]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      creating ||
      !name.trim() ||
      duplicateGroup ||
      (newGroup && !groupName.trim())
    )
      return;
    setError(null);
    setCreating(true);
    try {
      const { workspace, message } = await Workspace.new({
        name: name.trim(),
        accessMode,
        memberIds: accessMode === "private" ? memberIds : [],
        groupId: newGroup ? "" : groupId,
        groupName: newGroup ? groupName.trim() : "",
        groupGlobal: newGroup && canManageGlobal && groupGlobal,
      });
      if (!workspace) {
        setError(message || t("new-workspace.failed"));
        return;
      }
      if (selectedGroup.id) await refresh();
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_CREATED_EVENT, { detail: { workspace } })
      );
      hideModal();
      navigate(paths.workspace.chat(workspace.slug));
    } catch {
      setError(t("new-workspace.failed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!creating) hideModal();
      }}
      className="relative z-99"
    >
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <Dialog.Panel className="dsh-dialog flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-theme-sidebar-border px-5 py-3">
            <Dialog.Title className="text-base font-semibold text-theme-text-primary">
              {t("new-workspace.title")}
            </Dialog.Title>
            <button
              onClick={hideModal}
              disabled={creating}
              type="button"
              className={`${secondaryButton} w-10 px-0`}
              aria-label={t("new-workspace.close")}
            >
              <X size={18} />
            </button>
          </div>
          <form
            onSubmit={handleCreate}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <fieldset
                disabled={creating}
                className="min-w-0 space-y-5 disabled:opacity-70"
              >
                <div>
                  <label
                    htmlFor="new-workspace-name"
                    className="mb-2 block text-sm font-medium text-theme-text-primary"
                  >
                    {t("common.workspaces-name")}
                  </label>
                  <input
                    id="new-workspace-name"
                    className="dsh-control h-10 w-full px-3 text-sm placeholder:text-theme-settings-input-placeholder"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("new-workspace.placeholder")}
                    required
                    maxLength={255}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <fieldset>
                  <legend className="text-sm font-medium text-theme-text-primary">
                    {t("new-workspace.type")}
                  </legend>
                  <p className="mb-3 mt-1 text-xs text-theme-text-secondary">
                    {t("new-workspace.type_hint")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {accessOptions.map(({ value, icon: Icon }) => {
                      const selected = accessMode === value;
                      return (
                        <label
                          key={value}
                          className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-primary-button ${selected ? "border-primary-button bg-theme-sidebar-subitem-hover" : "border-theme-sidebar-border hover:bg-theme-sidebar-subitem-hover"} ${creating ? "cursor-wait" : ""}`}
                        >
                          <input
                            className="sr-only"
                            type="radio"
                            name="accessMode"
                            value={value}
                            checked={selected}
                            onChange={() => {
                              setAccessMode(value);
                              if (
                                (value === "private") !==
                                (accessMode === "private")
                              )
                                setGroupId("");
                            }}
                          />
                          <Icon
                            size={18}
                            className={`mt-0.5 shrink-0 ${selected ? "text-primary-button" : "text-theme-text-secondary"}`}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-theme-text-primary">
                              {t(`general.access.${value}.title`)}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-theme-text-secondary">
                              {t(`general.access.${value}.description`)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {accessMode === "private" && (
                  <section aria-labelledby="new-workspace-members">
                    <div className="flex items-center justify-between gap-2">
                      <h4
                        id="new-workspace-members"
                        className="text-sm font-medium text-theme-text-primary"
                      >
                        {t("new-workspace.members")}
                      </h4>
                      {memberIds.length > 0 && (
                        <span className="text-xs tabular-nums text-theme-text-secondary">
                          {t("new-workspace.members_count", {
                            count: memberIds.length,
                          })}
                        </span>
                      )}
                    </div>
                    <p className="mb-3 mt-1 text-xs text-theme-text-secondary">
                      {t(
                        user?.id
                          ? "new-workspace.members_hint"
                          : "new-workspace.members_single"
                      )}
                    </p>
                    {user?.id && (
                      <>
                        <div className="relative">
                          <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute left-3 top-3 text-theme-text-secondary"
                          />
                          <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            aria-label={t("new-workspace.members_search")}
                            placeholder={t("new-workspace.members_search")}
                            className="dsh-control h-10 w-full pl-9 pr-3 text-sm"
                            disabled={membersLoading || membersError}
                          />
                        </div>
                        <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-theme-sidebar-border p-1">
                          {membersLoading ? (
                            <p
                              role="status"
                              className="flex items-center gap-2 px-2 py-3 text-xs text-theme-text-secondary"
                            >
                              <CircleNotch size={14} className="animate-spin" />
                              {t("new-workspace.members_loading")}
                            </p>
                          ) : membersError ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
                              <p
                                role="alert"
                                className="text-xs text-red-400 light:text-red-700"
                              >
                                {t("new-workspace.members_failed")}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  setReloadMembers((value) => value + 1)
                                }
                                className={secondaryButton}
                              >
                                {t("new-workspace.retry")}
                              </button>
                            </div>
                          ) : !filteredUsers.length ? (
                            <p className="px-2 py-3 text-xs text-theme-text-secondary">
                              {t("new-workspace.members_empty")}
                            </p>
                          ) : (
                            filteredUsers.map((member) => (
                              <label
                                key={member.id}
                                className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-theme-sidebar-subitem-hover focus-within:ring-2 focus-within:ring-primary-button"
                              >
                                <input
                                  type="checkbox"
                                  checked={memberIds.includes(member.id)}
                                  disabled={
                                    !memberIds.includes(member.id) &&
                                    memberIds.length >= 100
                                  }
                                  onChange={(event) =>
                                    setMemberIds((ids) =>
                                      event.target.checked
                                        ? [...ids, member.id]
                                        : ids.filter((id) => id !== member.id)
                                    )
                                  }
                                  className="h-4 w-4 shrink-0 accent-[var(--theme-button-primary)] disabled:opacity-50"
                                />
                                <span className="min-w-0 flex-1 truncate text-sm text-theme-text-primary">
                                  {member.displayName || member.username}
                                </span>
                                <span className="max-w-[45%] truncate text-xs text-theme-text-secondary">
                                  {member.employeeNumber ||
                                    (member.displayName ? member.username : "")}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                        {memberIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setMemberIds([])}
                            className={`${secondaryButton} mt-1 text-xs`}
                          >
                            {t("new-workspace.clear")}
                          </button>
                        )}
                        {memberIds.length >= 100 && (
                          <p className="text-xs text-theme-text-secondary">
                            {t("new-workspace.members_limit")}
                          </p>
                        )}
                      </>
                    )}
                  </section>
                )}
                <div>
                  <Listbox
                    value={selectedGroup.id}
                    onChange={setGroupId}
                    disabled={!ready || creating}
                  >
                    <Listbox.Label className="block text-sm font-medium text-theme-text-primary">
                      {t("new-workspace.group")}
                    </Listbox.Label>
                    <p className="mb-2 mt-1 text-xs text-theme-text-secondary">
                      {t("workspace_groups.visibility_hint")}
                    </p>
                    <div className="relative">
                      <Listbox.Button className="dsh-control flex h-10 w-full items-center gap-2 px-3 text-sm text-theme-text-primary disabled:cursor-wait disabled:opacity-50">
                        <FolderSimple
                          size={17}
                          className="shrink-0 text-theme-text-secondary"
                        />
                        <span className="flex-1 truncate text-left">
                          {ready
                            ? selectedGroup.name
                            : t("new-workspace.group_loading")}
                        </span>
                        <CaretDown size={14} />
                      </Listbox.Button>
                      <Listbox.Options className="absolute bottom-full z-10 mb-1 max-h-48 w-full overflow-y-auto rounded-lg border border-theme-sidebar-border bg-theme-bg-secondary p-1 text-sm shadow-sm focus:outline-none">
                        {groupOptions.map((group) => (
                          <Listbox.Option
                            key={group.id}
                            value={group.id}
                            className={({ active }) =>
                              `flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-theme-text-primary ${active ? "bg-theme-sidebar-subitem-hover" : ""}`
                            }
                          >
                            {({ selected }) => (
                              <>
                                <span className="min-w-0 flex-1 truncate">
                                  {group.name}
                                </span>
                                {group.global && (
                                  <span className="shrink-0 text-xs text-theme-text-secondary">
                                    {t("workspace_groups.global")}
                                  </span>
                                )}
                                {selected && (
                                  <Check
                                    size={15}
                                    className="shrink-0 text-primary-button"
                                  />
                                )}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                      </Listbox.Options>
                    </div>
                  </Listbox>
                  {newGroup && (
                    <div className="mt-2">
                      <label
                        className="sr-only"
                        htmlFor="new-workspace-group-name"
                      >
                        {t("new-workspace.group_name")}
                      </label>
                      <input
                        id="new-workspace-group-name"
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        placeholder={t("new-workspace.group_name")}
                        required
                        maxLength={40}
                        aria-invalid={duplicateGroup}
                        aria-describedby={
                          duplicateGroup
                            ? "new-workspace-group-error"
                            : undefined
                        }
                        className="dsh-control h-10 w-full px-3 text-sm"
                      />
                      {canManageGlobal && (
                        <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-theme-text-primary hover:bg-theme-sidebar-subitem-hover focus-within:ring-2 focus-within:ring-primary-button">
                          <input
                            type="checkbox"
                            checked={groupGlobal}
                            onChange={(event) =>
                              setGroupGlobal(event.target.checked)
                            }
                            className="h-4 w-4 accent-[var(--theme-button-primary)]"
                          />
                          {t("workspace_groups.global_checkbox")}
                        </label>
                      )}
                      {duplicateGroup && (
                        <p
                          id="new-workspace-group-error"
                          className="mt-2 text-xs text-red-400 light:text-red-700"
                        >
                          {t("workspace_groups.duplicate")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {error && (
                  <p
                    role="alert"
                    className="text-sm text-red-400 light:text-red-700"
                  >
                    {error}
                  </p>
                )}
              </fieldset>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-theme-sidebar-border px-5 py-3">
              <button
                type="button"
                disabled={creating}
                onClick={hideModal}
                className={secondaryButton}
              >
                {t("new-workspace.cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  creating ||
                  !name.trim() ||
                  duplicateGroup ||
                  (newGroup && !groupName.trim())
                }
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary-button px-4 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating && <CircleNotch size={15} className="animate-spin" />}
                {t(
                  creating
                    ? "sidebar-create.creating-workspace"
                    : "sidebar-create.confirm-workspace"
                )}
              </button>
            </div>
          </form>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

export function useNewWorkspaceModal() {
  const [showing, setShowing] = useState(false);
  const showModal = () => setShowing(true);
  const hideModal = () => setShowing(false);
  return { showing, showModal, hideModal };
}
