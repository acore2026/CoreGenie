import type {
  Announcement,
  AnnouncementPayload,
} from "@coregenie/contracts/announcements.mts";
import { api } from "@/utils/api";
import i18n from "@/i18n";

function request<T = Record<string, unknown>>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown
): Promise<T> {
  return api.request<T>(path, {
    method,
    body,
    cache: "no-store",
    defaultError: i18n.t("announcements.requestError"),
  });
}

const Announcements = {
  list: (admin = false) =>
    request<{ announcements?: Announcement[] }>(
      admin ? "/admin/announcements" : "/announcements"
    ),
  read: (id: number | string) => request(`/announcements/${id}/read`, "POST"),
  save: (id: number | string | null | undefined, data: AnnouncementPayload) =>
    request<{ announcement?: Announcement }>(
      `/admin/announcements${id ? `/${id}` : ""}`,
      id ? "PUT" : "POST",
      data
    ),
  delete: (id: number | string) =>
    request(`/admin/announcements/${id}`, "DELETE"),
};

export default Announcements;
