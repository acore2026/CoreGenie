import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./lib/queryKeys";
import { createContext, useEffect, type PropsWithChildren } from "react";
import CoreGenie from "./media/logo/coregenie.svg";
import CoreGenieDark from "./media/logo/coregenie-dark.svg";
import System from "./models/system";

export const REFETCH_LOGO_EVENT = "refetch-logo";

function isLightMode() {
  const appliedTheme = document.documentElement.getAttribute("data-theme");
  if (appliedTheme) return appliedTheme === "light";

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") return true;
  if (savedTheme === "dark" || savedTheme === "default") return false;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
}
interface InstanceLogo {
  logo: string;
  loginLogo: string;
  isCustomLogo: boolean;
}
export const LogoContext = createContext<
  (InstanceLogo & { setLogo: (url: string | null) => void }) | null
>(null);
const initial: InstanceLogo = { logo: "", loginLogo: "", isCustomLogo: false };

async function loadLogo(): Promise<InstanceLogo> {
  const fallback = isLightMode() ? CoreGenieDark : CoreGenie;
  const { logoURL, isCustomLogo } = await System.fetchLogo();
  return {
    logo: logoURL || fallback,
    loginLogo: (isCustomLogo && logoURL) || fallback,
    isCustomLogo: Boolean(logoURL && isCustomLogo),
  };
}

export function LogoProvider({ children }: PropsWithChildren) {
  const client = useQueryClient();
  const queryKey = queryKeys.system.logo;
  const { data = initial, refetch } = useQuery({ queryKey, queryFn: loadLogo });
  useEffect(() => {
    const refresh = () => {
      void refetch();
    };
    window.addEventListener(REFETCH_LOGO_EVENT, refresh);
    return () => window.removeEventListener(REFETCH_LOGO_EVENT, refresh);
  }, [refetch]);

  function setLogo(url: string | null) {
    void client.cancelQueries({ queryKey });
    client.setQueryData<InstanceLogo>(queryKey, (old = initial) => ({
      ...old,
      logo: url ?? "",
    }));
  }

  return (
    <LogoContext.Provider value={{ ...data, setLogo }}>
      {children}
    </LogoContext.Provider>
  );
}
