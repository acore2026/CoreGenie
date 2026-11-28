import { USER_PROMPT_INPUT_MAP } from "@/utils/constants";
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import debounce from "lodash.debounce";
import { safeJsonParse } from "@/utils/request";
import { touchThreadDraft } from "@/utils/threadDraft";

/**
 * Synchronizes prompt input value with localStorage, scoped to the current thread.
 *
 * Persists unsent prompt text across page refreshes and navigation. Each thread/workspace maintains
 * its own draft state independently. Storage key is determined by thread slug (if in a thread) or
 * workspace slug (if in default chat).
 *
 * Storage format (stored under USER_PROMPT_INPUT_MAP key):
 * ```json
 * {
 *   "thread-slug": "user's draft message...",
 *   "workspace-slug": "another draft message..."
 * }
 * ```
 *
 * @param {Object} props
 * @param {string} props.promptInput - Current prompt input value to sync
 * @param {Function} props.setPromptInput - State setter function for prompt input
 * @returns {void}
 */
/**
 * Immediately clears the stored draft for a given thread/workspace key.
 * Used before state updates that may remount PromptInput to prevent
 * stale text from being restored.
 * @param {string} storageKey - thread slug or workspace slug
 */
export function clearPromptInputDraft(storageKey: string) {
  try {
    const map = safeJsonParse<Record<string, string>>(
      localStorage.getItem(USER_PROMPT_INPUT_MAP),
      {}
    );
    map[storageKey] = "";
    localStorage.setItem(USER_PROMPT_INPUT_MAP, JSON.stringify(map));
  } catch {}
}

export default function usePromptInputStorage({
  promptInput,
  setPromptInput,
  storageKey,
}: {
  promptInput: string;
  setPromptInput: (value: string) => void;
  storageKey?: string | null;
}) {
  const { threadSlug = null, slug: workspaceSlug } = useParams();
  useEffect(() => {
    const serializedPromptInputMap =
      localStorage.getItem(USER_PROMPT_INPUT_MAP) || "{}";

    const promptInputMap = safeJsonParse<Record<string, string>>(
      serializedPromptInputMap,
      {}
    );

    const key = storageKey ?? threadSlug ?? workspaceSlug;
    if (!key) return;
    const userPromptInputValue = promptInputMap[key];
    if (userPromptInputValue) {
      setPromptInput(userPromptInputValue);
    }
  }, []);

  const debouncedWriteToStorage = useMemo(
    () =>
      debounce((value: string, slug: string) => {
        const serializedPromptInputMap =
          localStorage.getItem(USER_PROMPT_INPUT_MAP) || "{}";
        const promptInputMap = safeJsonParse<Record<string, string>>(
          serializedPromptInputMap,
          {}
        );
        promptInputMap[slug] = value;
        localStorage.setItem(
          USER_PROMPT_INPUT_MAP,
          JSON.stringify(promptInputMap)
        );
      }, 500),
    []
  );

  useEffect(() => {
    const key = storageKey ?? threadSlug ?? workspaceSlug;
    if (!key) return;
    if (promptInput) touchThreadDraft(key);
    debouncedWriteToStorage(promptInput, key);

    return () => {
      debouncedWriteToStorage.flush();
    };
  }, [
    promptInput,
    storageKey,
    threadSlug,
    workspaceSlug,
    debouncedWriteToStorage,
  ]);
}
