import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import i18n from "@/i18n";

async function request(path, method = "GET", body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...baseHeaders(), "Content-Type": "application/json" },
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      result.error || i18n.t("announcements.requestError")
    );
    error.status = response.status;
    throw error;
  }
  return result;
}

export default {
  list: (admin = false) =>
    request(admin ? "/admin/announcements" : "/announcements"),
  read: (id) => request(`/announcements/${id}/read`, "POST"),
  save: (id, data) =>
    request(
      `/admin/announcements${id ? `/${id}` : ""}`,
      id ? "PUT" : "POST",
      data
    ),
  delete: (id) => request(`/admin/announcements/${id}`, "DELETE"),
};
