import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@coregenie/contracts/predefinedAgents.mts";
import PredefinedAgent from "@/models/predefinedAgent";
import { queryKeys } from "@/lib/queryKeys";

const STORAGE_KEY = "anythingllm-selected-predefined-agent";
export const PREDEFINED_AGENT_CHANGE_EVENT = "predefinedAgentChange";

function storedAgentId(): number | null {
  const value = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export interface UsePredefinedAgentResult {
  agents: Agent[];
  loading: boolean;
  selectedAgentId: number | null;
  defaultAgentId: number | null;
  selectedAgent: Agent | null;
  selectAgent: (agentId: number | string | null) => void;
  refresh: () => Promise<Agent[]>;
}

export default function usePredefinedAgent(): UsePredefinedAgentResult {
  const queryClient = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(
    storedAgentId
  );

  const { data, isPending, refetch } = useQuery({
    queryKey: queryKeys.predefinedAgents.all,
    queryFn: () => PredefinedAgent.list(),
  });

  const agents = data?.agents ?? [];
  const defaultAgentId = data?.defaultAgentId ?? null;

  useEffect(() => {
    if (!data) return;
    const currentId = storedAgentId();
    const currentIsValid = data.agents.some((agent) => agent.id === currentId);
    if (currentId && !currentIsValid) {
      localStorage.removeItem(STORAGE_KEY);
    }
    setSelectedAgentId(
      currentIsValid
        ? currentId
        : data.defaultAgentId || data.agents[0]?.id || null
    );
  }, [data]);

  const refresh = useCallback(async (): Promise<Agent[]> => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.predefinedAgents.all,
    });
    const result = await refetch();
    return result.data?.agents ?? [];
  }, [queryClient, refetch]);

  useEffect(() => {
    const onOrderChanged = () => {
      void refresh();
    };
    window.addEventListener("displayOrderChanged", onOrderChanged);
    return () =>
      window.removeEventListener("displayOrderChanged", onOrderChanged);
  }, [refresh]);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: number | null }>).detail;
      setSelectedAgentId(detail?.agentId ?? null);
    };
    window.addEventListener(PREDEFINED_AGENT_CHANGE_EVENT, sync);
    return () =>
      window.removeEventListener(PREDEFINED_AGENT_CHANGE_EVENT, sync);
  }, []);

  const selectAgent = useCallback((agentId: number | string | null) => {
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
    loading: isPending,
    selectedAgentId,
    defaultAgentId,
    selectedAgent: agents.find((agent) => agent.id === selectedAgentId) || null,
    selectAgent,
    refresh,
  };
}
