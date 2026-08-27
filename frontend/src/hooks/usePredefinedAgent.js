import { useCallback, useEffect, useState } from "react";
import PredefinedAgent from "@/models/predefinedAgent";

const STORAGE_KEY = "anythingllm-selected-predefined-agent";
export const PREDEFINED_AGENT_CHANGE_EVENT = "predefinedAgentChange";

function storedAgentId() {
  const value = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export default function usePredefinedAgent() {
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(storedAgentId);
  const [defaultAgentId, setDefaultAgentId] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { agents: nextAgents, defaultAgentId: nextDefaultAgentId } =
      await PredefinedAgent.list();
    setAgents(nextAgents);
    setDefaultAgentId(nextDefaultAgentId);
    const currentId = storedAgentId();
    const currentIsValid = nextAgents.some((agent) => agent.id === currentId);
    if (currentId && !currentIsValid) {
      localStorage.removeItem(STORAGE_KEY);
    }
    setSelectedAgentId(
      currentIsValid
        ? currentId
        : nextDefaultAgentId || nextAgents[0]?.id || null
    );
    setLoading(false);
    return nextAgents;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sync = (event) => setSelectedAgentId(event.detail?.agentId ?? null);
    window.addEventListener(PREDEFINED_AGENT_CHANGE_EVENT, sync);
    return () =>
      window.removeEventListener(PREDEFINED_AGENT_CHANGE_EVENT, sync);
  }, []);

  const selectAgent = useCallback((agentId) => {
    const normalized = agentId ? Number(agentId) : null;
    if (normalized) localStorage.setItem(STORAGE_KEY, String(normalized));
    else localStorage.removeItem(STORAGE_KEY);
    setSelectedAgentId(normalized);
    window.dispatchEvent(
      new CustomEvent(PREDEFINED_AGENT_CHANGE_EVENT, {
        detail: { agentId: normalized },
      })
    );
  }, []);

  return {
    agents,
    loading,
    selectedAgentId,
    defaultAgentId,
    selectedAgent: agents.find((agent) => agent.id === selectedAgentId) || null,
    selectAgent,
    refresh,
  };
}
