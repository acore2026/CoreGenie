import { useEffect, useState } from "react";
import { FullScreenLoader } from "@/components/Preloader";
import System from "@/models/system";
import paths from "@/utils/paths";

let cachedViewable = null;
let pendingViewable = null;

async function resolveViewable({ refresh = false } = {}) {
  if (!refresh && cachedViewable !== null) return cachedViewable;
  if (!pendingViewable) {
    pendingViewable = System.fetchCanViewChatHistory()
      .then(({ viewable }) => {
        cachedViewable = viewable;
        return viewable;
      })
      .finally(() => {
        pendingViewable = null;
      });
  }
  return pendingViewable;
}

/**
 * Protects the view from system set ups who cannot view chat history.
 * If the user cannot view chat history, they are redirected to the home page.
 * @param {React.ReactNode} children
 */
export function CanViewChatHistory({ children }) {
  const { loading, viewable } = useCanViewChatHistory();
  if (loading) return <FullScreenLoader />;
  if (!viewable) {
    window.location.href = paths.home();
    return <FullScreenLoader />;
  }

  return <>{children}</>;
}

/**
 * Provides the `viewable` state to the children.
 * @returns {React.ReactNode}
 */
export function CanViewChatHistoryProvider({ children }) {
  const { loading, viewable } = useCanViewChatHistory();
  if (loading) return null;
  return <>{children({ viewable })}</>;
}

/**
 * Hook that fetches the can view chat history state from local storage or the system settings.
 * @returns {Promise<{viewable: boolean, error: string | null}>}
 */
export function useCanViewChatHistory() {
  const [loading, setLoading] = useState(cachedViewable === null);
  const [viewable, setViewable] = useState(cachedViewable ?? false);

  useEffect(() => {
    let active = true;
    async function fetchViewable() {
      // Revalidate cached permission silently so settings navigation never
      // collapses while still respecting permission changes during a session.
      const viewable = await resolveViewable({
        refresh: cachedViewable !== null,
      });
      if (!active) return;
      setViewable(viewable);
      setLoading(false);
    }
    fetchViewable();
    return () => {
      active = false;
    };
  }, []);

  return { loading, viewable };
}
