import {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { cleanHeaders } from "./utils/apiClient";
import {
  fetchEventSource,
  type EventSourceMessage,
} from "@microsoft/fetch-event-source";
import { API_BASE } from "@/utils/constants";
import { baseHeaders, safeJsonParse } from "@/utils/request";
import Workspace from "@/models/workspace";

interface FileProgress {
  status: "pending" | "embedding" | "failed" | "complete";
  error?: string;
  chunksProcessed?: number;
  totalChunks?: number;
}
type ProgressMap = Record<string, Record<string, FileProgress>>;
interface EmbeddingContext {
  embeddingProgressMap: ProgressMap;
  startEmbedding: (slug: string, filenames: string[]) => void;
  connectSSE: (slug: string) => void;
  removeQueuedFile: (slug: string, filename: string) => Promise<boolean>;
}
type ProgressEvent =
  | { type: "batch_starting"; filenames: string[] }
  | { type: "doc_starting" | "doc_complete" | "file_removed"; filename: string }
  | {
      type: "chunk_progress";
      filename: string;
      chunksProcessed: number;
      totalChunks: number;
    }
  | { type: "doc_failed"; filename: string; error?: string }
  | { type: "all_complete"; error?: string };
const EmbeddingProgressContext = createContext<EmbeddingContext | null>(null);

export function useEmbeddingProgress() {
  const context = useContext(EmbeddingProgressContext);
  if (!context)
    throw new Error("useEmbeddingProgress requires EmbeddingProgressProvider");
  return context;
}

/**
 * Workspace-specific hook that auto-connects SSE on mount and provides
 * a callback when progress is cleared (embedding complete + auto-clear timeout).
 * @param {string} slug - Workspace slug
 * @param {Object} options
 * @param {Function} [options.onProgressCleared] - Called when progress transitions from active to cleared
 */
export function useWorkspaceEmbeddingProgress(
  slug: string,
  { onProgressCleared }: { onProgressCleared?: () => void } = {}
) {
  const { embeddingProgressMap, startEmbedding, connectSSE, removeQueuedFile } =
    useEmbeddingProgress();
  const embeddingProgress = embeddingProgressMap[slug] || null;

  // Store callback in ref to avoid stale closures
  const onProgressClearedRef = useRef(onProgressCleared);
  useEffect(() => {
    onProgressClearedRef.current = onProgressCleared;
  }, [onProgressCleared]);

  // Auto-connect SSE on mount to catch any active embedding job
  useEffect(() => {
    connectSSE(slug);
  }, [slug, connectSSE]);

  // Detect when progress is cleared (non-null → null) and invoke callback
  const prevProgressRef = useRef(embeddingProgress);
  useEffect(() => {
    if (prevProgressRef.current && !embeddingProgress) {
      onProgressClearedRef.current?.();
    }
    prevProgressRef.current = embeddingProgress;
  }, [embeddingProgress]);

  const removeQueued = useCallback(
    (filename: string) => removeQueuedFile(slug, filename),
    [slug, removeQueuedFile]
  );

  return { embeddingProgress, startEmbedding, removeQueuedFile: removeQueued };
}

const CLEANUP_DELAY_MS = 1_500;
export function EmbeddingProgressProvider({ children }: PropsWithChildren) {
  const [embeddingProgressMap, setEmbeddingProgressMap] = useState<ProgressMap>(
    {}
  );
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const cleanupTimeoutsRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  useEffect(() => {
    const controllers = abortControllersRef.current;
    const timers = cleanupTimeoutsRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
      Object.values(controllers).forEach((ctrl) => ctrl?.abort());
    };
  }, []);

  const updateFileStatus = useCallback(
    (slug: string, filename: string, status: FileProgress) =>
      setEmbeddingProgressMap((prev) => ({
        ...prev,
        [slug]: { ...prev[slug], [filename]: status },
      })),
    []
  );

  const handleMessage = useCallback(
    (slug: string, msg: EventSourceMessage, ctrl: AbortController) => {
      const data = safeJsonParse<ProgressEvent | null>(msg.data, null);
      if (!data) return;

      switch (data.type) {
        case "batch_starting": {
          const initial = Object.fromEntries(
            (data.filenames || []).map((name) => [
              name,
              { status: "pending" as const },
            ])
          );
          setEmbeddingProgressMap((prev) => ({
            ...prev,
            [slug]: { ...initial, ...prev[slug] },
          }));
          break;
        }

        case "doc_starting":
          updateFileStatus(slug, data.filename, {
            status: "embedding",
            chunksProcessed: 0,
            totalChunks: 0,
          });
          break;

        case "chunk_progress":
          updateFileStatus(slug, data.filename, {
            status: "embedding",
            chunksProcessed: data.chunksProcessed,
            totalChunks: data.totalChunks,
          });
          break;

        case "doc_complete":
          updateFileStatus(slug, data.filename, { status: "complete" });
          break;

        case "doc_failed":
          updateFileStatus(slug, data.filename, {
            status: "failed",
            error: data.error || "Embedding failed",
          });
          break;

        case "file_removed":
          setEmbeddingProgressMap((prev) => {
            const slugMap = { ...prev[slug] };
            delete slugMap[data.filename];
            if (Object.keys(slugMap).length === 0) {
              const { [slug]: _, ...rest } = prev;
              return rest;
            }
            return { ...prev, [slug]: slugMap };
          });
          break;

        case "all_complete":
          // If there was an error, mark all pending or embedding files as failed
          // because something went wrong and we don't know the status of the files
          if (data.error) {
            setEmbeddingProgressMap((prev) => {
              const slugMap = { ...prev[slug] };
              for (const [filename, info] of Object.entries(slugMap)) {
                if (info.status === "pending" || info.status === "embedding") {
                  slugMap[filename] = {
                    status: "failed",
                    error: data.error,
                  };
                }
              }
              return { ...prev, [slug]: slugMap };
            });
          }
          ctrl.abort();
          delete abortControllersRef.current[slug];
          cleanupTimeoutsRef.current[slug] = setTimeout(() => {
            setEmbeddingProgressMap((prev) => {
              const { [slug]: _, ...rest } = prev;
              return rest;
            });
            delete cleanupTimeoutsRef.current[slug];
          }, CLEANUP_DELAY_MS);
          break;
      }
    },
    [updateFileStatus]
  );

  /**
   * Open (or reconnect) an SSE connection for a given workspace slug.
   * Updates embeddingProgressMap in real time as events arrive.
   */
  const connectSSE = useCallback(
    (slug: string) => {
      if (abortControllersRef.current[slug]) return;

      const ctrl = new AbortController();
      abortControllersRef.current[slug] = ctrl;

      fetchEventSource(`${API_BASE}/workspace/${slug}/embed-progress`, {
        method: "GET",
        headers: cleanHeaders({ ...baseHeaders() }),
        signal: ctrl.signal,
        openWhenHidden: true,
        onmessage: (msg) => handleMessage(slug, msg, ctrl),
        onclose: () => delete abortControllersRef.current[slug],
        onerror: () => {
          delete abortControllersRef.current[slug];
          throw new Error("SSE connection error");
        },
      }).catch(() => {});
    },
    [handleMessage]
  );

  const startEmbedding = useCallback(
    (slug: string, filenames: string[]) => {
      abortControllersRef.current[slug]?.abort();
      delete abortControllersRef.current[slug];

      if (cleanupTimeoutsRef.current[slug]) {
        clearTimeout(cleanupTimeoutsRef.current[slug]);
        delete cleanupTimeoutsRef.current[slug];
      }

      const newEntries = Object.fromEntries(
        filenames.map((name) => [name, { status: "pending" as const }])
      );
      setEmbeddingProgressMap((prev) => ({
        ...prev,
        [slug]: newEntries,
      }));

      connectSSE(slug);
    },
    [connectSSE]
  );

  const removeQueuedFile = useCallback(
    async (slug: string, filename: string) => {
      const { success } = await Workspace.removeQueuedEmbedding(slug, filename);
      return success;
    },
    []
  );

  return (
    <EmbeddingProgressContext.Provider
      value={{
        embeddingProgressMap,
        startEmbedding,
        connectSSE,
        removeQueuedFile,
      }}
    >
      {children}
    </EmbeddingProgressContext.Provider>
  );
}
