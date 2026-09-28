import React, { useRef, useState } from "react";
import { CircleNotch, X } from "@phosphor-icons/react";
import Workspace from "@/models/workspace";
import paths from "@/utils/paths";
import { useTranslation } from "react-i18next";
import ModalWrapper from "@/components/ModalWrapper";
import { useNavigate } from "react-router-dom";
import { WORKSPACE_CREATED_EVENT } from "@/components/Sidebar/events";

const noop = () => false;
export default function NewWorkspaceModal({ hideModal = noop }) {
  const formEl = useRef(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const handleCreate = async (e) => {
    if (creating) return;
    setError(null);
    setCreating(true);
    e.preventDefault();
    const data = {};
    const form = new FormData(formEl.current);
    for (var [key, value] of form.entries()) data[key] = value;
    const { workspace, message } = await Workspace.new(data);
    if (!!workspace) {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_CREATED_EVENT, {
          detail: { workspace },
        })
      );
      hideModal();
      navigate(paths.workspace.chat(workspace.slug));
      return;
    }
    setError(message);
    setCreating(false);
  };

  return (
    <ModalWrapper isOpen={true}>
      <div className="dsh-dialog mx-4 w-full max-w-xl">
        <div className="relative border-b border-theme-sidebar-border px-5 py-4">
          <div className="w-full flex gap-x-2 items-center">
            <h3 className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold text-theme-text-primary">
              {t("new-workspace.title")}
            </h3>
          </div>
          <button
            onClick={hideModal}
            type="button"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-theme-text-secondary transition-colors hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
          >
            <X size={17} weight="bold" />
          </button>
        </div>
        <div
          className="h-full w-full overflow-y-auto"
          style={{ maxHeight: "calc(100vh - 200px)" }}
        >
          <form ref={formEl} onSubmit={handleCreate}>
            <div className="flex-col space-y-2 px-5 py-5">
              <div className="w-full flex flex-col gap-y-4">
                <div>
                  <label
                    htmlFor="name"
                    className="mb-2 block text-sm font-medium text-theme-text-primary"
                  >
                    {t("common.workspaces-name")}
                  </label>
                  <input
                    name="name"
                    type="text"
                    id="name"
                    className="dsh-control block h-10 w-full px-3 text-sm placeholder:text-theme-settings-input-placeholder"
                    placeholder={t("new-workspace.placeholder")}
                    required={true}
                    autoComplete="off"
                    autoFocus={true}
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-300 light:text-red-700">
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="flex w-full items-center justify-end space-x-2 border-t border-theme-sidebar-border px-5 py-4">
              <button
                type="submit"
                disabled={creating}
                className="flex h-9 items-center gap-2 rounded-md bg-theme-button-primary px-4 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg-primary disabled:cursor-wait disabled:opacity-50"
              >
                {creating && <CircleNotch size={15} className="animate-spin" />}
                {creating
                  ? t("sidebar-create.creating-workspace")
                  : t("sidebar-create.confirm-workspace")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalWrapper>
  );
}

export function useNewWorkspaceModal() {
  const [showing, setShowing] = useState(false);
  const showModal = () => {
    setShowing(true);
  };
  const hideModal = () => {
    setShowing(false);
  };

  return { showing, showModal, hideModal };
}
