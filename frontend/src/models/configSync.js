import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(suffix = "", payload) {
  const response = await fetch(`${API_BASE}/admin/config-sync${suffix}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: baseHeaders(),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export default {
  status: () => request(),
  detail: (key) => request(`/detail?key=${encodeURIComponent(key)}`),
  retry: () => request("/reconcile", {}),
  resolve: (detail, side) =>
    request("/resolve", {
      key: detail.key,
      fileHash: detail.fileHash,
      databaseHash: detail.databaseHash,
      side,
    }),
};
