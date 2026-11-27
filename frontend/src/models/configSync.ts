import { api } from "@/utils/api";

export interface ConfigSyncDetailRef {
  key: string;
  fileHash?: string | null;
  databaseHash?: string | null;
}

const ConfigSync = {
  status: () => api.get<Record<string, unknown>>("/admin/config-sync"),
  detail: (key: string) =>
    api.get<Record<string, unknown>>(
      `/admin/config-sync/detail?key=${encodeURIComponent(key)}`
    ),
  retry: () =>
    api.post<Record<string, unknown>>("/admin/config-sync/reconcile", {}),
  resolve: (detail: ConfigSyncDetailRef, side: string) =>
    api.post<Record<string, unknown>>("/admin/config-sync/resolve", {
      key: detail.key,
      fileHash: detail.fileHash,
      databaseHash: detail.databaseHash,
      side,
    }),
};

export default ConfigSync;
