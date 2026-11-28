import { useState, useCallback } from "react";
import Admin from "@/models/admin";
import { SUB_SKILL_REGISTRY, getPreferenceKeyForSkill } from "./skillRegistry";
import { toggleAgentSessionTool } from "@/utils/chat/agent";

/**
 * Hook to manage sub-skill preferences for all skills in the registry.
 * Handles loading, checking enabled state, and toggling sub-skills.
 *
 * This hook eliminates the need for separate state variables for each skill's
 * sub-skills. Adding a new skill with sub-skills only requires updating the
 * skillRegistry.ts file.
 */
export default function useSubSkillPreferences() {
  // Single state object holding disabled sub-skills for all skills
  // Key: preferenceKey, Value: array of disabled sub-skill names
  const [disabledSubSkills, setDisabledSubSkills] = useState<
    Record<string, string[]>
  >({});

  /**
   * Load sub-skill preferences from settings object.
   * Called after fetching system preferences.
   */
  const loadFromSettings = useCallback((settings: Record<string, unknown>) => {
    if (!settings) return;

    const loaded: Record<string, string[]> = {};
    for (const [, config] of Object.entries(SUB_SKILL_REGISTRY)) {
      const value = settings[config.preferenceKey];
      loaded[config.preferenceKey] = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    }
    setDisabledSubSkills(loaded);
  }, []);

  /**
   * Check if a sub-skill is enabled for a given skill.
   */
  const isSubSkillEnabled = useCallback(
    (skillKey: string, subSkillName: string) => {
      const prefKey = getPreferenceKeyForSkill(skillKey);
      if (!prefKey) return true;

      const disabled = disabledSubSkills[prefKey] ?? [];
      return !disabled.includes(subSkillName);
    },
    [disabledSubSkills]
  );

  /**
   * Toggle a sub-skill's enabled state.
   */
  const toggleSubSkill = useCallback(
    async (skillKey: string, subSkillName: string) => {
      const prefKey = getPreferenceKeyForSkill(skillKey);
      if (!prefKey) return;

      const current = disabledSubSkills[prefKey] ?? [];
      const updated = current.includes(subSkillName)
        ? current.filter((s) => s !== subSkillName)
        : [...current, subSkillName];

      setDisabledSubSkills((prev) => ({
        ...prev,
        [prefKey]: updated,
      }));

      await Admin.updateSystemPreferences({
        [prefKey]: updated.join(","),
      });
      toggleAgentSessionTool(subSkillName, !updated.includes(subSkillName));
    },
    [disabledSubSkills]
  );

  return {
    loadFromSettings,
    isSubSkillEnabled,
    toggleSubSkill,
    disabledSubSkills,
  };
}
