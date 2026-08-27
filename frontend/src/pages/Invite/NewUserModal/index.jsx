import React, { useState } from "react";
import Invite from "@/models/invite";
import paths from "@/utils/paths";
import { Link, useParams } from "react-router-dom";
import { CircleNotch } from "@phosphor-icons/react";
import { AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import System from "@/models/system";
import { useTranslation } from "react-i18next";
import {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
} from "@/utils/username";

export default function NewUserModal({ invite }) {
  const { code } = useParams();
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const { t } = useTranslation();

  const handleCreate = async (e) => {
    if (creating) return;
    setError(null);
    setCreating(true);
    e.preventDefault();
    const data = {};
    const form = new FormData(e.target);
    for (var [key, value] of form.entries()) data[key] = value;
    const { success, workspaces, error } = await Invite.acceptInvite(
      code,
      data
    );
    if (success) {
      const { valid, user, token, message } = await System.requestToken(data);
      if (valid && !!token && !!user) {
        window.localStorage.setItem(AUTH_USER, JSON.stringify(user));
        window.localStorage.setItem(AUTH_TOKEN, token);
        window.location = workspaces?.[0]?.slug
          ? paths.workspace.chat(workspaces[0].slug)
          : paths.home();
      } else {
        setError(message);
        setCreating(false);
      }
      return;
    }
    setError(error);
    setCreating(false);
  };

  return (
    <div className="relative w-full max-w-2xl max-h-full">
      <div className="relative w-full max-w-2xl bg-theme-bg-secondary rounded-lg shadow border-2 border-theme-modal-border">
        <div className="flex items-start justify-between p-4 border-b rounded-t border-theme-modal-border">
          <h3 className="text-xl font-semibold text-theme-text-primary">
            {invite?.workspaces?.[0]?.name
              ? t("workspace-invite.register-title", {
                  workspace: invite.workspaces[0].name,
                })
              : t("workspace-invite.register-fallback-title")}
          </h3>
        </div>
        <form onSubmit={handleCreate}>
          <div className="p-6 space-y-6 flex h-full w-full">
            <div className="w-full flex flex-col gap-y-4">
              <div>
                <label
                  htmlFor="username"
                  className="block mb-2 text-sm font-medium text-theme-text-primary"
                >
                  {t("workspace-invite.username")}
                </label>
                <input
                  name="username"
                  type="text"
                  className="border-none bg-theme-settings-input-bg text-theme-text-primary placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
                  placeholder={t("workspace-invite.username-placeholder")}
                  minLength={USERNAME_MIN_LENGTH}
                  maxLength={USERNAME_MAX_LENGTH}
                  pattern={USERNAME_PATTERN}
                  required={true}
                  autoComplete="off"
                />
                <p className="mt-2 text-xs text-theme-text-secondary">
                  {t("common.username_requirements")}
                </p>
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="block mb-2 text-sm font-medium text-theme-text-primary"
                >
                  {t("workspace-invite.password")}
                </label>
                <input
                  name="password"
                  type="password"
                  className="border-none bg-theme-settings-input-bg text-theme-text-primary placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
                  placeholder={t("workspace-invite.password-placeholder")}
                  required={true}
                  minLength={8}
                  autoComplete="off"
                />
              </div>
              {error && <p className="text-red-400 text-sm">Error: {error}</p>}
              <p className="text-theme-text-secondary text-xs md:text-sm">
                {t("workspace-invite.register-description")}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col items-center gap-3 border-t border-theme-modal-border p-6">
            <button
              type="submit"
              disabled={creating}
              className="w-full transition-all duration-300 border border-theme-text-primary px-4 py-2 rounded-lg text-theme-text-primary text-sm items-center flex gap-x-2 hover:bg-theme-text-primary hover:text-theme-bg-primary focus:ring-gray-800 text-center justify-center"
            >
              {creating && <CircleNotch size={17} className="animate-spin" />}
              {creating
                ? t("workspace-invite.registering")
                : t("workspace-invite.register-and-join")}
            </button>
            <Link
              to={`/login?nt=1&redirectTo=${encodeURIComponent(
                `/accept-invite/${code}`
              )}`}
              className="whitespace-nowrap text-sm text-theme-text-secondary underline decoration-white/20 underline-offset-4 hover:text-theme-text-primary"
            >
              {t("workspace-invite.already-account")}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
