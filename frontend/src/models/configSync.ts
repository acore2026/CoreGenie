import { api } from "@/utils/api";

export interface ConfigSyncDetailRef {
  key: string;
  fileHash?: string | null;
  databaseHash?: string | null;
}

export interface ConfigSyncStatus {
  enabled: boolean;
  directory?: string;
  error?: string;
  items?: { key: string; name: string; status: string; error?: string }[];
}
export interface ConfigSyncDetail extends ConfigSyncDetailRef {
  file: string | null;
  database: string | null;
  error: string | null;
}
const ConfigSync = {
  status: () => api.get<ConfigSyncStatus>("/admin/config-sync"),
  detail: (key: string) =>
    api.get<ConfigSyncDetail>(
      `/admin/config-sync/detail?key=${encodeURIComponent(key)}`
    ),
  retry: () => api.post<ConfigSyncStatus>("/admin/config-sync/reconcile", {}),
  resolve: (detail: ConfigSyncDetailRef, side: string) =>
    api.post<ConfigSyncStatus>("/admin/config-sync/resolve", {
      key: detail.key,
      fileHash: detail.fileHash,
      databaseHash: detail.databaseHash,
      side,
    }),
};

export default ConfigSync;
