import usePfp from "@/hooks/usePfp";
import System from "@/models/system";
import Appearance from "@/models/appearance";
import { AUTH_USER } from "@/utils/constants";
import showToast from "@/utils/toast";
import { Info, Plus, X } from "@phosphor-icons/react";
import ModalWrapper from "@/components/ModalWrapper";
import { useTheme } from "@/hooks/useTheme";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Tooltip } from "react-tooltip";
import { safeJsonParse } from "@/utils/request";
import Toggle from "@/components/lib/Toggle";
import {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
} from "@/utils/username";

export default function AccountModal({ user, hideModal }) {
  const { pfp, setPfp } = usePfp();
  const { t } = useTranslation();

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return false;

    const formData = new FormData();
    formData.append("file", file);
    const { success, error } = await System.uploadPfp(formData);
    if (!success) {
      showToast(t("profile_settings.failed_upload", { error }), "error");
      return;
    }

    const pfpUrl = await System.fetchPfp(user.id);
    setPfp(pfpUrl);
    showToast(t("profile_settings.upload_success"), "success");
  };

  const handleRemovePfp = async () => {
    const { success, error } = await System.removePfp();
    if (!success) {
      showToast(t("profile_settings.failed_remove", { error }), "error");
      return;
    }

    setPfp(null);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();

    const data = {};
    const form = new FormData(e.target);
    for (var [key, value] of form.entries()) {
      if (value === null || (key === "password" && !value)) continue;
      data[key] = value;
    }

    const { success, error } = await System.updateUser(data);
    if (success) {
      let storedUser = safeJsonParse(localStorage.getItem(AUTH_USER), null);
      if (storedUser) {
        storedUser.username = data.username;
        storedUser.bio = data.bio;
        storedUser.systemPrompt = data.systemPrompt;
        localStorage.setItem(AUTH_USER, JSON.stringify(storedUser));
      }
      showToast(t("profile_settings.profile_updated"), "success", {
        clear: true,
      });
      hideModal();
    } else {
      showToast(t("profile_settings.failed_update_user", { error }), "error");
    }
  };
  return (
    <ModalWrapper isOpen={true}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        className="personal-settings-panel flex h-[min(720px,calc(100vh-32px))] w-[min(860px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-theme-sidebar-border bg-theme-bg-secondary text-theme-text-primary"
      >
        <header className="flex h-14 shrink-0 items-center justify-between px-5">
          <h2
            id="account-settings-title"
            className="truncate text-base font-semibold"
          >
            {t("profile_settings.edit_account")}
          </h2>
          <button
            onClick={hideModal}
            type="button"
            aria-label={t("profile_settings.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
          >
            <X size={16} weight="bold" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 max-md:flex-col">
          <aside className="flex w-[220px] shrink-0 flex-col items-center border-r border-theme-sidebar-border px-6 py-8 max-md:w-full max-md:flex-row max-md:justify-start max-md:border-b max-md:border-r-0 max-md:py-4">
            <div className="flex flex-col items-center max-md:flex-row max-md:gap-4">
              <label className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-theme-sidebar-border bg-theme-control-bg transition-colors duration-150 hover:border-theme-button-primary focus-within:ring-2 focus-within:ring-theme-button-primary">
                <input
                  id="logo-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                {pfp ? (
                  <img
                    src={pfp}
                    alt="用户头像"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-3 text-center">
                    <Plus className="mb-1 h-5 w-5 text-theme-text-secondary" />
                    <span className="text-xs font-medium text-theme-text-secondary">
                      {t("profile_settings.profile_picture")}
                    </span>
                  </div>
                )}
              </label>
              <div className="mt-4 min-w-0 text-center max-md:mt-0 max-md:text-left">
                <p className="truncate text-sm font-semibold text-theme-text-primary">
                  {user.username}
                </p>
                <p className="mt-1 text-xs text-theme-text-secondary">
                  {t("profile_settings.profile_picture_hint")}
                </p>
                {pfp && (
                  <button
                    type="button"
                    onClick={handleRemovePfp}
                    className="mt-3 rounded-md text-xs font-medium text-theme-text-secondary transition-colors hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
                  >
                    {t("profile_settings.remove_profile_picture")}
                  </button>
                )}
              </div>
            </div>
          </aside>
          <form
            onSubmit={handleUpdate}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-8">
              <section>
                <h3 className="mb-4 text-sm font-semibold text-theme-text-primary">
                  {t("profile_settings.account")}
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="username"
                      className="mb-2 block text-sm font-medium text-theme-text-primary"
                    >
                      {t("profile_settings.username")}
                    </label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      className="dsh-control block h-10 w-full px-3 text-sm"
                      placeholder={t("profile_settings.username_placeholder")}
                      minLength={USERNAME_MIN_LENGTH}
                      maxLength={USERNAME_MAX_LENGTH}
                      pattern={USERNAME_PATTERN}
                      defaultValue={user.username}
                      required
                      autoComplete="off"
                    />
                    <p className="mt-2 text-xs leading-5 text-theme-text-secondary">
                      {t("common.username_requirements")}
                    </p>
                  </div>
                  <div>
                    <label
                      htmlFor="password"
                      className="mb-2 block text-sm font-medium text-theme-text-primary"
                    >
                      {t("profile_settings.new_password")}
                    </label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      className="dsh-control block h-10 w-full px-3 text-sm"
                      placeholder={t(
                        "profile_settings.new_password_placeholder"
                      )}
                      minLength={8}
                      autoComplete="new-password"
                    />
                    <p className="mt-2 text-xs leading-5 text-theme-text-secondary">
                      {t("profile_settings.password_description")}
                    </p>
                  </div>
                </div>
                <div className="mt-5">
                  <label
                    htmlFor="bio"
                    className="mb-2 block text-sm font-medium text-theme-text-primary"
                  >
                    {t("profile_settings.bio")}
                  </label>
                  <textarea
                    id="bio"
                    name="bio"
                    className="dsh-control block min-h-20 w-full resize-y px-3 py-2.5 text-sm"
                    placeholder={t("profile_settings.bio_placeholder")}
                    defaultValue={user.bio}
                  />
                </div>
                <div className="mt-5">
                  <label
                    htmlFor="systemPrompt"
                    className="mb-2 block text-sm font-medium text-theme-text-primary"
                  >
                    {t("profile_settings.system_prompt")}
                  </label>
                  <textarea
                    id="systemPrompt"
                    name="systemPrompt"
                    maxLength={40000}
                    className="dsh-control block min-h-28 w-full resize-y px-3 py-2.5 text-sm"
                    placeholder={t(
                      "profile_settings.system_prompt_placeholder"
                    )}
                    defaultValue={user.systemPrompt || ""}
                  />
                  <p className="mt-2 text-xs leading-5 text-theme-text-secondary">
                    {t("profile_settings.system_prompt_description")}
                  </p>
                </div>
              </section>
              <section className="mt-8 border-t border-theme-sidebar-border pt-6">
                <h3 className="mb-4 text-sm font-semibold text-theme-text-primary">
                  {t("profile_settings.preferences")}
                </h3>
                <div className="space-y-1">
                  <ThemePreference />
                  <AutoSubmitPreference />
                  <AutoSpeakPreference />
                </div>
              </section>
            </div>
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-theme-sidebar-border px-6 py-4">
              <button
                onClick={hideModal}
                type="button"
                className="h-9 rounded-lg px-4 text-sm font-medium text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
              >
                {t("profile_settings.cancel")}
              </button>
              <button
                type="submit"
                className="h-9 rounded-lg bg-theme-button-primary px-4 text-sm font-semibold text-black transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg-secondary"
              >
                {t("profile_settings.update_account")}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </ModalWrapper>
  );
}

function ThemePreference() {
  const { theme, setTheme, availableThemes } = useTheme();
  const { t } = useTranslation();
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-theme-sidebar-subitem-hover">
      <label
        htmlFor="theme"
        className="text-sm font-medium text-theme-text-primary"
      >
        {t("profile_settings.theme")}
      </label>
      <select
        name="theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className="dsh-control h-9 w-fit px-3 text-sm"
      >
        {Object.entries(availableThemes).map(([key, value]) => (
          <option key={key} value={key}>
            {value}
          </option>
        ))}
      </select>
    </div>
  );
}

function AutoSubmitPreference() {
  const [autoSubmitSttInput, setAutoSubmitSttInput] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    const settings = Appearance.getSettings();
    setAutoSubmitSttInput(settings.autoSubmitSttInput ?? true);
  }, []);

  const handleChange = (checked) => {
    setAutoSubmitSttInput(checked);
    Appearance.updateSettings({ autoSubmitSttInput: checked });
  };

  return (
    <div className="flex min-h-12 items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-theme-sidebar-subitem-hover">
      <div className="flex items-center gap-1">
        <label
          htmlFor="autoSubmit"
          className="text-sm font-medium text-theme-text-primary"
        >
          {t("customization.chat.auto_submit.title")}
        </label>
        <div
          data-tooltip-id="auto-submit-info"
          data-tooltip-content={t("customization.chat.auto_submit.description")}
          className="h-fit cursor-help"
        >
          <Info size={15} className="text-theme-text-secondary" />
        </div>
      </div>
      <Toggle size="lg" enabled={autoSubmitSttInput} onChange={handleChange} />
      <Tooltip
        id="auto-submit-info"
        place="bottom"
        delayShow={300}
        className="allm-tooltip !allm-text-xs"
      />
    </div>
  );
}

function AutoSpeakPreference() {
  const [autoPlayAssistantTtsResponse, setAutoPlayAssistantTtsResponse] =
    useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const settings = Appearance.getSettings();
    setAutoPlayAssistantTtsResponse(
      settings.autoPlayAssistantTtsResponse ?? false
    );
  }, []);

  const handleChange = (checked) => {
    setAutoPlayAssistantTtsResponse(checked);
    Appearance.updateSettings({ autoPlayAssistantTtsResponse: checked });
  };

  return (
    <div className="flex min-h-12 items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-theme-sidebar-subitem-hover">
      <div className="flex items-center gap-1">
        <label
          htmlFor="autoSpeak"
          className="text-sm font-medium text-theme-text-primary"
        >
          {t("customization.chat.auto_speak.title")}
        </label>
        <div
          data-tooltip-id="auto-speak-info"
          data-tooltip-content={t("customization.chat.auto_speak.description")}
          className="h-fit cursor-help"
        >
          <Info size={15} className="text-theme-text-secondary" />
        </div>
      </div>
      <Toggle
        size="lg"
        enabled={autoPlayAssistantTtsResponse}
        onChange={handleChange}
      />
      <Tooltip
        id="auto-speak-info"
        place="bottom"
        delayShow={300}
        className="allm-tooltip !allm-text-xs"
      />
    </div>
  );
}
