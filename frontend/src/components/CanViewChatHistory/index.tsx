import { useQuery } from "@tanstack/react-query";
import useUser from "@/hooks/useUser";
import { queryKeys } from "@/lib/queryKeys";
import { FullScreenLoader } from "@/components/Preloader";
import System from "@/models/system";
import paths from "@/utils/paths";

export function CanViewChatHistory({ children }: React.PropsWithChildren) {
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
export function CanViewChatHistoryProvider({
  children,
}: {
  children: (permissions: { viewable: boolean }) => React.ReactNode;
}) {
  const { loading, viewable } = useCanViewChatHistory();
  if (loading) return null;
  return <>{children({ viewable })}</>;
}

/**
 * Hook that fetches the can view chat history state from local storage or the system settings.
 * @returns {Promise<{viewable: boolean, error: string | null}>}
 */
export function useCanViewChatHistory() {
  const { user, authToken } = useUser();
  const { data, isPending } = useQuery({
    queryKey: queryKeys.system.chatHistoryPermission(user?.id, authToken),
    queryFn: () => System.fetchCanViewChatHistory(),
    refetchOnMount: "always",
  });
  return { loading: isPending, viewable: data?.viewable ?? false };
}
