import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(path = "", method = "GET", body) {
  try {
    const response = await fetch(`${API_BASE}/personal-skills${path}`, {
      method,
      headers: baseHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) return { success: false, error: data.error };
    return data;
  } catch {
    return { success: false, error: null };
  }
}
export default {
  list: (view) => request(`?view=${view}`),
  get: (id) => request(`/${id}`),
  create: (body) => request("", "POST", body),
  update: (id, body) => request(`/${id}`, "PUT", body),
  remove: (id) => request(`/${id}`, "DELETE"),
  share: (id, isShared) => request(`/${id}/sharing`, "PATCH", { isShared }),
  enable: (id, enabled) => request(`/${id}/enabled`, "PUT", { enabled }),
};
