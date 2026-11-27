class RuntimeSettings {
  static _instance = null;
  settings = {};

  settingConfigs = {
    seenAnyIpWarning: {
      default: false,
      validate: (value) => String(value) === "true",
    },
    allowAnyIp: {
      default: false,
      validate: (value) => String(value) === "true",
    },
  };

  constructor() {
    if (RuntimeSettings._instance) return RuntimeSettings._instance;
    RuntimeSettings._instance = this;
    return this;
  }

  applyOptions(options = {}) {
    for (const [key, value] of Object.entries(options || {})) {
      if (!Object.prototype.hasOwnProperty.call(this.settingConfigs, key))
        continue;
      this.set(key, value);
    }
  }

  /**
   * Get a runtime setting
   * - Will throw an error if the setting requested is not a supported runtime setting key
   * - Will return the default value if the setting requested is not set at all
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    if (!this.settingConfigs[key])
      throw new Error(`Invalid runtime setting: ${key}`);
    return this.settings.hasOwnProperty(key)
      ? this.settings[key]
      : this.settingConfigs[key].default;
  }

  /**
   * Set a runtime setting
   * - Will throw an error if the setting requested is not a supported runtime setting key
   * - Will validate the value against the setting's validate function
   * @param {string} key
   * @param {any} value
   * @returns {void}
   */
  set(key, value = null) {
    if (!this.settingConfigs[key])
      throw new Error(`Invalid runtime setting: ${key}`);
    this.settings[key] = this.settingConfigs[key].validate(value);
  }
}

module.exports = RuntimeSettings;
