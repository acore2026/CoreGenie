import type {
  Memory as MemoryRecord,
  MemoryScope,
  WorkspaceMemories,
} from "@coregenie/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
type MemoryWorkspace = { slug: string; name?: string };
type MemoryMode = "edit" | "create";
const emptyMemories: WorkspaceMemories = { global: [], workspace: [] };
import { createContext, useContext, useState } from "react";
import { useMemoriesSidebar } from "../ChatSidebar";
import useUser from "@/hooks/useUser";
import System from "@/models/system";
import Memory from "@/models/memory";

export const LIMITS = {
  workspace: 20,
  global: 5,
};

const MemoriesContext = createContext<ReturnType<typeof useMemoryState> | null>(
  null
);

export function useMemoriesContext() {
  const ctx = useContext(MemoriesContext);
  if (!ctx) {
    throw new Error("useMemoriesContext must be used within MemoriesProvider");
  }
  return ctx;
}

function useMemoryState(workspace: MemoryWorkspace) {
  const { sidebarOpen, closeSidebar } = useMemoriesSidebar();
  const { user, authToken } = useUser();
  const client = useQueryClient();
  const canToggle = !user || user?.role === "admin";

  const [activeTab, setActiveTab] = useState<MemoryScope>("workspace");
  const [modalState, setModalState] = useState<{
    open: boolean;
    mode: MemoryMode;
  }>({ open: false, mode: "create" });
  const [editingMemory, setEditingMemory] = useState<MemoryRecord | null>(null);
  const settingsKey = queryKeys.system.memorySettings(user?.id, authToken);
  const { data: settings, isPending: loadingEnabled } = useQuery({
    queryKey: settingsKey,
    enabled: sidebarOpen,
    refetchOnMount: "always",
    queryFn: async () => {
      const settings = await System.keys();
      return {
        enabled: Boolean(settings?.MemoryEnabled),
        autoExtraction: settings?.MemoryAutoExtraction !== false,
      };
    },
  });
  const enabled = settings?.enabled ?? false;
  const autoExtraction = settings?.autoExtraction ?? true;
  function setEnabled(value: boolean) {
    client.setQueryData(settingsKey, (old: typeof settings) => ({
      autoExtraction: old?.autoExtraction ?? true,
      enabled: value,
    }));
  }
  function setAutoExtraction(value: boolean) {
    client.setQueryData(settingsKey, (old: typeof settings) => ({
      enabled: old?.enabled ?? false,
      autoExtraction: value,
    }));
  }
  const memoryKey = queryKeys.workspaces.memories(
    user?.id,
    authToken,
    workspace.slug
  );
  const { data: memories = emptyMemories } = useQuery({
    queryKey: memoryKey,
    queryFn: () => Memory.forWorkspace(workspace.slug),
    enabled: sidebarOpen && enabled && Boolean(workspace.slug),
  });
  const refreshMemories = () =>
    client.invalidateQueries({
      queryKey: queryKeys.workspaces.memories(user?.id, authToken),
    });
  async function handleCreate(content: string) {
    const { memory } = await Memory.create(workspace.slug, {
      content,
      scope: activeTab,
    });
    if (memory) await refreshMemories();
  }

  async function handleDelete(memoryId: number) {
    await Memory.delete(memoryId);
    await refreshMemories();
  }

  async function handleUpdate(memoryId: number, content: string) {
    const { memory } = await Memory.update(memoryId, { content });
    if (memory) await refreshMemories();
  }

  async function handlePromote(memoryId: number) {
    const { memory } = await Memory.promoteToGlobal(memoryId);
    if (memory) await refreshMemories();
  }

  async function handleDemote(memoryId: number) {
    if (!workspace?.slug) return;
    const { memory } = await Memory.demoteToWorkspace(memoryId, workspace.slug);
    if (memory) await refreshMemories();
  }

  function openCreateModal() {
    setEditingMemory(null);
    setModalState({ open: true, mode: "create" });
  }

  function openEditModal(memory: MemoryRecord) {
    setEditingMemory(memory);
    setModalState({ open: true, mode: "edit" });
  }

  function closeModal() {
    setModalState({ open: false, mode: "create" });
    setEditingMemory(null);
  }

  const activeMemories =
    activeTab === "workspace" ? memories.workspace : memories.global;

  return {
    workspace,
    sidebarOpen,
    closeSidebar,
    canToggle,
    memories,
    activeTab,
    setActiveTab,
    activeMemories,
    enabled,
    setEnabled,
    autoExtraction,
    setAutoExtraction,
    loadingEnabled,
    modalState,
    editingMemory,
    openCreateModal,
    openEditModal,
    closeModal,
    handleCreate,
    handleDelete,
    handleUpdate,
    handlePromote,
    handleDemote,
  };
}

export function MemoriesProvider({
  workspace,
  children,
}: React.PropsWithChildren<{ workspace: MemoryWorkspace }>) {
  const value = useMemoryState(workspace);
  return (
    <MemoriesContext.Provider value={value}>
      {children}
    </MemoriesContext.Provider>
  );
}
