type Setting = "allowAnyIp" | "seenAnyIpWarning";
function isSetting(key: string): key is Setting {
  return key === "allowAnyIp" || key === "seenAnyIpWarning";
}

class RuntimeSettings {
  private settings = new Map<Setting, boolean>();
  applyOptions(options: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(options ?? {})) {
      if (isSetting(key)) this.set(key, value);
    }
  }
  get(key: Setting) {
    return this.settings.get(key) ?? false;
  }
  set(key: Setting, value: unknown) {
    this.settings.set(key, String(value) === "true");
  }
}
export default new RuntimeSettings();
