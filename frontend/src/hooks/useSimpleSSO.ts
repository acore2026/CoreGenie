import { useQuery } from "@tanstack/react-query";
import System from "@/models/system";
import { queryKeys } from "@/lib/queryKeys";

const disabled = { enabled: false, noLogin: false, noLoginRedirect: null };

export default function useSimpleSSO() {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.system.simpleSSO,
    staleTime: 0,
    queryFn: async () => {
      const settings = await System.keys();
      return {
        enabled: settings?.SimpleSSOEnabled === true,
        noLogin: settings?.SimpleSSONoLogin === true,
        noLoginRedirect:
          typeof settings?.SimpleSSONoLoginRedirect === "string"
            ? settings.SimpleSSONoLoginRedirect
            : null,
      };
    },
  });
  return { loading: isPending, ssoConfig: data ?? disabled };
}
