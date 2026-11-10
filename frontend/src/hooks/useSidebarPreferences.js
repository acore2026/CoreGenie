import { useEffect, useSyncExternalStore } from "react";
import useUser from "@/hooks/useUser";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { favoritesKey, parseFavorites } from "@/utils/workspaceFavorites.mjs";
import {
  normalizeWorkspaceGroups,
  workspaceGroupsKey,
} from "@/utils/workspaceGroups.mjs";
import showToast from "@/utils/toast";
import i18n from "@/i18n";
import { v4 as uuidv4 } from "uuid";

const stores = new Map();
function legacy(userId) {
  try {
    return {
      groups: normalizeWorkspaceGroups(
        JSON.parse(localStorage.getItem(workspaceGroupsKey(userId)))
      ),
      favorites: parseFavorites(localStorage.getItem(favoritesKey(userId))),
    };
  } catch {
    return {
      groups: normalizeWorkspaceGroups(null),
      favorites: parseFavorites(null),
    };
  }
}
function createStore(userId, token) {
  let state = legacy(userId);
  let ready = false;
  let busy = false;
  let saving = false;
  let notified = false;
  let imported = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  const fail = () => showToast(i18n.t("sidebar_sync.failed"), "error");
  async function request(method, body) {
    const response = await fetch(`${API_BASE}/user/sidebar-preferences`, {
      method,
      headers: { ...baseHeaders(token), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("sync failed");
    const value = await response.json();
    return value.preferences
      ? { ...value.preferences, globalGroups: value.globalGroups }
      : null;
  }
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    isReady: () => ready,
    isSaving: () => saving,
    async refresh() {
      if (busy) return;
      busy = true;
      try {
        const remote = await request("GET");
        state =
          remote ??
          (await request("POST", {
            groups: normalizeWorkspaceGroups(null),
            favorites: parseFavorites(null),
          }));
        if (!imported) {
          const local = legacy(userId);
          if (
            local.groups.groups.length ||
            Object.keys(local.groups.collapsed).length ||
            local.favorites.workspaces.length ||
            local.favorites.threads.length
          ) {
            const migrationKey = `sidebar-migration:v1:${userId ?? "single-user"}`;
            let migrationId = localStorage.getItem(migrationKey);
            if (!migrationId) {
              migrationId = uuidv4();
              localStorage.setItem(migrationKey, migrationId);
            }
            state = await request("PUT", {
              type: "import",
              migrationId,
              preferences: local,
            });
          }
          imported = true;
        }
        ready = true;
        notified = false;
        emit();
      } catch {
        if (!notified) fail();
        notified = true;
      } finally {
        busy = false;
      }
    },
    save(operation, next) {
      if (!ready || busy) {
        showToast(i18n.t("sidebar_sync.wait"), "error");
        return false;
      }
      busy = true;
      const previous = state;
      saving = true;
      state = next;
      emit();
      request("PUT", operation)
        .then((value) => {
          state = value;
        })
        .catch(() => {
          state = previous;
          fail();
        })
        .finally(() => {
          busy = false;
          saving = false;
          emit();
        });
      return true;
    },
  };
}

export default function useSidebarPreferences() {
  const { user, authToken } = useUser();
  const key = `${user?.id ?? "single-user"}:${authToken ?? ""}`;
  if (!stores.has(key)) stores.set(key, createStore(user?.id, authToken));
  const store = stores.get(key);
  const preferences = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => {
    store.references = (store.references || 0) + 1;
    if (store.references === 1) {
      store.refresh();
      store.timer = setInterval(() => {
        if (document.visibilityState === "visible") store.refresh();
      }, 15000);
      window.addEventListener("focus", store.refresh);
    }
    return () => {
      if (--store.references === 0) {
        clearInterval(store.timer);
        window.removeEventListener("focus", store.refresh);
      }
    };
  }, [store]);
  return {
    preferences,
    save: store.save,
    ready: store.isReady(),
    saving: store.isSaving(),
    refresh: store.refresh,
  };
}
