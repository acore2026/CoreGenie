import {
  useMutation,
  useQuery,
  useQueryClient,
  useIsMutating,
} from "@tanstack/react-query";
import useUser from "@/hooks/useUser";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { cleanHeaders } from "@/utils/apiClient";
import { favoritesKey, parseFavorites } from "@/utils/workspaceFavorites";
import {
  normalizeWorkspaceGroups,
  workspaceGroupsKey,
  type GroupSettings,
} from "@/utils/workspaceGroups";
import showToast from "@/utils/toast";
import i18n from "@/i18n";
import { v4 as uuidv4 } from "uuid";
import { useMemo } from "react";
import { queryKeys } from "@/lib/queryKeys";

type UserId = number | undefined;
interface Preferences {
  groups: GroupSettings;
  favorites: ReturnType<typeof parseFavorites>;
  globalGroups: GroupSettings;
}

function legacy(userId: UserId): Preferences {
  let groups: unknown;
  let favorites: string | null = null;
  try {
    groups = JSON.parse(
      localStorage.getItem(workspaceGroupsKey(userId)) ?? "null"
    );
    favorites = localStorage.getItem(favoritesKey(userId));
  } catch {}
  return {
    groups: normalizeWorkspaceGroups(groups),
    favorites: parseFavorites(favorites),
    globalGroups: normalizeWorkspaceGroups(null),
  };
}

async function request(
  token: string | null,
  method: string,
  body?: unknown
): Promise<Preferences | null> {
  const response = await fetch(`${API_BASE}/user/sidebar-preferences`, {
    method,
    headers: cleanHeaders({
      ...baseHeaders(token),
      "Content-Type": "application/json",
    }),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("Sidebar request failed");
  const value = await response.json();
  if (!value.preferences) return null;
  return {
    ...value.preferences,
    globalGroups: normalizeWorkspaceGroups(value.globalGroups),
  };
}

function required(value: Preferences | null) {
  if (!value) throw new Error("Missing sidebar preferences");
  return value;
}

export default function useSidebarPreferences() {
  const { user, authToken } = useUser();
  const userId = user?.id;
  const client = useQueryClient();
  const key = queryKeys.workspaces.sidebar(userId, authToken);
  const saving = useIsMutating({ mutationKey: key }) > 0;
  const local = useMemo(() => legacy(userId), [userId]);
  const fail = () => showToast(i18n.t("sidebar_sync.failed"), "error");

  const query = useQuery({
    queryKey: key,
    enabled: !saving,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
    retry: false,
    queryFn: async () => {
      try {
        let remote = await request(authToken, "GET");
        if (!remote)
          remote = required(
            await request(authToken, "POST", {
              groups: normalizeWorkspaceGroups(null),
              favorites: parseFavorites(null),
            })
          );
        if (
          !client.getQueryData(key) &&
          (local.groups.groups.length ||
            Object.keys(local.groups.collapsed).length ||
            local.favorites.workspaces.length ||
            local.favorites.threads.length)
        ) {
          const migrationKey = `sidebar-migration:v1:${userId ?? "single-user"}`;
          const migrationId = localStorage.getItem(migrationKey) || uuidv4();
          localStorage.setItem(migrationKey, migrationId);
          remote = required(
            await request(authToken, "PUT", {
              type: "import",
              migrationId,
              preferences: { groups: local.groups, favorites: local.favorites },
            })
          );
        }
        return remote;
      } catch (error) {
        if (client.getQueryState(key)?.status !== "error") fail();
        throw error;
      }
    },
  });
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: async ({
      operation,
      token,
    }: {
      token: string | null;
      queryKey: typeof key;
      operation: Record<string, unknown>;
      next: Preferences;
    }) => required(await request(token, "PUT", operation)),
    onMutate: ({ next, queryKey }) => {
      const previous = client.getQueryData<Preferences>(queryKey);
      client.setQueryData(queryKey, next);
      return previous;
    },
    onSuccess: (value, { queryKey }) => {
      client.setQueryData(queryKey, value);
    },
    onError: (_error, { queryKey }, previous) => {
      client.setQueryData(queryKey, previous);
      fail();
    },
  });
  function save(operation: Record<string, unknown>, next: Preferences) {
    if (
      !query.data ||
      client.isFetching({ queryKey: key }) ||
      client.isMutating({ mutationKey: key })
    ) {
      showToast(i18n.t("sidebar_sync.wait"), "error");
      return false;
    }
    mutation.mutate({ operation, next, token: authToken, queryKey: key });
    return true;
  }
  return {
    preferences: query.data ?? local,
    ready: Boolean(query.data),
    saving,
    save,
    refresh: query.refetch,
  };
}
