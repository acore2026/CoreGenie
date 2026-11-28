import { APPEARANCE_SETTINGS } from "@/utils/constants";
import { safeJsonParse } from "@/utils/request";

export type AvailableAppearanceSetting =
  "showScrollbar" | "enableSpellCheck" | "renderHTML";

export interface AppearanceSettings {
  showScrollbar: boolean;
  enableSpellCheck: boolean;
  renderHTML: boolean;
}

const Appearance = {
  defaultSettings: {
    showScrollbar: true,
    enableSpellCheck: true,
    renderHTML: false,
  } as AppearanceSettings,

  getSettings: (): AppearanceSettings => {
    const settings = localStorage.getItem(APPEARANCE_SETTINGS);
    const parsedSettings = safeJsonParse<Partial<AppearanceSettings>>(
      settings,
      {}
    );
    return {
      ...Appearance.defaultSettings,
      ...(parsedSettings && typeof parsedSettings === "object"
        ? parsedSettings
        : {}),
    };
  },

  get: (key: AvailableAppearanceSetting): boolean => {
    const settings = Appearance.getSettings();
    return Object.prototype.hasOwnProperty.call(settings, key)
      ? settings[key]
      : Appearance.defaultSettings[key];
  },

  set: (
    key: AvailableAppearanceSetting,
    value: boolean
  ): AppearanceSettings => {
    const settings = Appearance.getSettings();
    settings[key] = value;
    Appearance.updateSettings(settings);
    return settings;
  },

  updateSettings: (
    newSettings: Partial<AppearanceSettings>
  ): AppearanceSettings => {
    const updatedSettings = { ...Appearance.getSettings(), ...newSettings };
    localStorage.setItem(APPEARANCE_SETTINGS, JSON.stringify(updatedSettings));
    return updatedSettings;
  },
};

export default Appearance;
