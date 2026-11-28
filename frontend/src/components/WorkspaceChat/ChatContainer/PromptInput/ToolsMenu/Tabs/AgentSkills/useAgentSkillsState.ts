import { useState, useEffect, useCallback } from "react";
import Admin from "@/models/admin";
import System from "@/models/system";
import AgentPlugins from "@/models/experimental/agentPlugins";
import MCPServers, { type MCPServerInfo } from "@/models/mcpServers";
import { getSubSkillPreferenceKeys } from "./skillRegistry";
import useSubSkillPreferences from "./useSubSkillPreferences";
import { toggleAgentSessionTool } from "@/utils/chat/agent";

/**
 * Core hook for managing all agent skill state.
 * Handles fetching, toggling, and persisting skill preferences.
 */
export interface ImportedSkill {
  hubId: string;
  name: string;
  active: boolean;
}
function importedSkill(value: unknown): value is ImportedSkill {
  return (
    typeof value === "object" &&
    value !== null &&
    "hubId" in value &&
    typeof value.hubId === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "active" in value &&
    typeof value.active === "boolean"
  );
}
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
export default function useAgentSkillsState(
  defaultSkills: Record<string, unknown>
) {
  // Core skill state
  const [fileSystemAgentAvailable, setFileSystemAgentAvailable] =
    useState(false);
  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [isMultiUser, setIsMultiUser] = useState(false);
  const [disabledDefaults, setDisabledDefaults] = useState<string[]>([]);
  const [enabledConfigurable, setEnabledConfigurable] = useState<string[]>([]);
  const [importedSkills, setImportedSkills] = useState<ImportedSkill[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpLoading, setMcpLoading] = useState(true);

  // Sub-skill preferences (managed by dedicated hook)
  const subSkillPrefs = useSubSkillPreferences();

  // Fetch all skill settings on mount
  useEffect(() => {
    fetchSkillSettings();
    fetchMcpServers();
  }, []);

  async function fetchSkillSettings() {
    try {
      const subSkillPrefKeys = getSubSkillPreferenceKeys();
      const [prefs, fsAgentAvailable, codeSandboxAvailable, multiUserMode] =
        await Promise.all([
          Admin.systemPreferencesByFields([
            "disabled_agent_skills",
            "default_agent_skills",
            "imported_agent_skills",
            ...subSkillPrefKeys,
          ]),
          System.isFileSystemAgentAvailable(),
          System.isSandboxAvailable(),
          System.isMultiUserMode(),
        ]);

      if (prefs?.settings) {
        setDisabledDefaults(stringList(prefs.settings.disabled_agent_skills));
        setEnabledConfigurable(stringList(prefs.settings.default_agent_skills));
        setImportedSkills(
          Array.isArray(prefs.settings.imported_agent_skills)
            ? prefs.settings.imported_agent_skills.filter(importedSkill)
            : []
        );
        subSkillPrefs.loadFromSettings(prefs.settings);
      }
      setFileSystemAgentAvailable(fsAgentAvailable);
      setSandboxAvailable(codeSandboxAvailable);
      setIsMultiUser(!!multiUserMode);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMcpServers() {
    try {
      const { servers = [] } = await MCPServers.listServers();
      setMcpServers(servers);
    } catch (e) {
      console.error(e);
    } finally {
      setMcpLoading(false);
    }
  }

  // Skill enabled/disabled checks
  const isSkillEnabled = useCallback(
    (key: string) => {
      return key in defaultSkills
        ? !disabledDefaults.includes(key)
        : enabledConfigurable.includes(key);
    },
    [defaultSkills, disabledDefaults, enabledConfigurable]
  );

  // Toggle functions
  const toggleSkill = useCallback(
    async (key: string) => {
      const toggleItem = (arr: string[], item: string) =>
        arr.includes(item) ? arr.filter((s) => s !== item) : [...arr, item];
      const newEnabled = !isSkillEnabled(key);

      if (key in defaultSkills) {
        const updated = toggleItem(disabledDefaults, key);
        setDisabledDefaults(updated);
        await Admin.updateSystemPreferences({
          disabled_agent_skills: updated.join(","),
          default_agent_skills: enabledConfigurable.join(","),
        });
        toggleAgentSessionTool(key, newEnabled);
        return;
      }

      const updated = toggleItem(enabledConfigurable, key);
      setEnabledConfigurable(updated);
      await Admin.updateSystemPreferences({
        disabled_agent_skills: disabledDefaults.join(","),
        default_agent_skills: updated.join(","),
      });
      toggleAgentSessionTool(key, newEnabled);
    },
    [defaultSkills, disabledDefaults, enabledConfigurable, isSkillEnabled]
  );

  const toggleImportedSkill = useCallback(async (skill: ImportedSkill) => {
    const newActive = !skill.active;
    setImportedSkills((prev) =>
      prev.map((s) =>
        s.hubId === skill.hubId ? { ...s, active: newActive } : s
      )
    );
    await AgentPlugins.toggleFeature(skill.hubId, newActive);
    toggleAgentSessionTool(skill.hubId, newActive);
  }, []);

  const toggleMcpTool = useCallback(
    async (serverName: string, toolName: string, currentlyEnabled: boolean) => {
      const newEnabled = !currentlyEnabled;
      setMcpServers((prev) => {
        return prev.map((server) => {
          if (server.name !== serverName) return server;
          const currentSuppressed =
            server.config?.anythingllm?.suppressedTools || [];
          const newSuppressed = newEnabled
            ? currentSuppressed.filter((t) => t !== toolName)
            : [...currentSuppressed, toolName];
          return {
            ...server,
            config: {
              ...server.config,
              anythingllm: {
                ...server.config?.anythingllm,
                suppressedTools: newSuppressed,
              },
            },
          };
        });
      });
      await MCPServers.toggleTool(serverName, toolName, newEnabled);
      toggleAgentSessionTool(
        `${serverName}-${toolName}`,
        newEnabled,
        serverName
      );
    },
    []
  );

  return {
    // State
    fileSystemAgentAvailable,
    sandboxAvailable,
    isMultiUser,
    disabledDefaults,
    enabledConfigurable,
    importedSkills,
    mcpServers,
    loading,
    mcpLoading,

    // Skill checks
    isSkillEnabled,

    // Toggle functions
    toggleSkill,
    toggleImportedSkill,
    toggleMcpTool,

    // Sub-skill preferences (delegated)
    isSubSkillEnabled: subSkillPrefs.isSubSkillEnabled,
    toggleSubSkill: subSkillPrefs.toggleSubSkill,
    disabledSubSkills: subSkillPrefs.disabledSubSkills,
  };
}
