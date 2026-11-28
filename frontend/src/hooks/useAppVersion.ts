import { useQuery } from "@tanstack/react-query";
import System from "@/models/system";
import { queryKeys } from "@/lib/queryKeys";

export default function useAppVersion(): {
  version: string | null;
  isLoading: boolean;
} {
  const { data: version = null, isPending } = useQuery<string | null>({
    queryKey: queryKeys.system.appVersion,
    queryFn: () => System.fetchAppVersion(),
    staleTime: 10 * 60_000,
  });

  return { version, isLoading: isPending };
}
