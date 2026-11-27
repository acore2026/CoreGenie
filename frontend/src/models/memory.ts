import type {
  Memory as MemoryRecord,
  MemoryScope,
  WorkspaceMemories,
} from "@coregenie/contracts/memory.mts";
import { api, errorMessage } from "@/utils/api";

export type { MemoryRecord, MemoryScope, WorkspaceMemories };

export interface MemoryMutationResult {
  memory: MemoryRecord | null;
  error?: string;
}

const Memory = {
  forWorkspace: async (slug: string): Promise<WorkspaceMemories> => {
    try {
      const res = await api.get<{ memories?: WorkspaceMemories }>(
        `/workspaces/${slug}/memories`
      );
      return res?.memories || { global: [], workspace: [] };
    } catch {
      return { global: [], workspace: [] };
    }
  },

  create: async (
    slug: string,
    { content, scope = "workspace" }: { content: string; scope?: MemoryScope }
  ): Promise<MemoryMutationResult> => {
    try {
      return await api.post<MemoryMutationResult>(
        `/workspaces/${slug}/memories`,
        { content, scope }
      );
    } catch (e) {
      return { memory: null, error: errorMessage(e) };
    }
  },

  update: async (
    memoryId: number,
    { content }: { content: string }
  ): Promise<MemoryMutationResult> => {
    try {
      return await api.put<MemoryMutationResult>(`/memories/${memoryId}`, {
        content,
      });
    } catch (e) {
      return { memory: null, error: errorMessage(e) };
    }
  },

  delete: async (
    memoryId: number
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await api.delete<{ success: boolean; error?: string }>(
        `/memories/${memoryId}`
      );
    } catch (e) {
      return { success: false, error: errorMessage(e) };
    }
  },

  promoteToGlobal: async (memoryId: number): Promise<MemoryMutationResult> => {
    try {
      return await api.post<MemoryMutationResult>(
        `/memories/${memoryId}/promote`
      );
    } catch (e) {
      return { memory: null, error: errorMessage(e) };
    }
  },

  demoteToWorkspace: async (
    memoryId: number,
    slug: string
  ): Promise<MemoryMutationResult> => {
    try {
      return await api.post<MemoryMutationResult>(
        `/memories/${memoryId}/demote/${slug}`
      );
    } catch (e) {
      return { memory: null, error: errorMessage(e) };
    }
  },
};

export default Memory;
