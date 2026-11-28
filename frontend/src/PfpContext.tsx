import { createContext, type PropsWithChildren } from "react";
import { useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
import { queryKeys } from "./lib/queryKeys";
import useUser from "./hooks/useUser";
import System from "./models/system";

interface ProfilePicture {
  pfp: string | null;
  setPfp: (url: string | null) => void;
}

export const PfpContext = createContext<ProfilePicture | null>(null);

export function PfpProvider({ children }: PropsWithChildren) {
  const { user } = useUser();
  const id = user?.id;
  const queryKey = queryKeys.system.profilePicture(id);
  const client = useQueryClient();
  const { data: pfp = null } = useQuery({
    queryKey,
    queryFn: id ? () => System.fetchPfp(id) : skipToken,
  });

  function setPfp(url: string | null) {
    void client.cancelQueries({ queryKey });
    client.setQueryData(queryKey, url);
  }

  return (
    <PfpContext.Provider value={{ pfp, setPfp }}>
      {children}
    </PfpContext.Provider>
  );
}
