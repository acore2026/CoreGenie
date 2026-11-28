import { api } from "@/utils/api";

const AgentPlugins = {
  toggleFeature: async function (
    hubId: string,
    active = false
  ): Promise<boolean> {
    try {
      await api.post(
        `/experimental/agent-plugins/${hubId}/toggle`,
        { active },
        { defaultError: "Could not update agent plugin status." }
      );
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  updatePluginConfig: async function (
    hubId: string,
    updates: Record<string, unknown> = {}
  ): Promise<boolean> {
    try {
      await api.post(
        `/experimental/agent-plugins/${hubId}/config`,
        { updates },
        { defaultError: "Could not update agent plugin config." }
      );
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  deletePlugin: async function (hubId: string): Promise<boolean> {
    try {
      await api.delete(`/experimental/agent-plugins/${hubId}`, undefined, {
        defaultError: "Could not delete agent plugin config.",
      });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },
};

export default AgentPlugins;
