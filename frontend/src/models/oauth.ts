import { API_BASE } from "@/utils/constants";
import { api } from "@/utils/api";

export function authConfig(): Promise<Record<string, unknown>> {
  return api.get<Record<string, unknown>>("/auth/config", {
    auth: false,
    cache: "no-store",
    defaultError: "Authentication unavailable",
  });
}

export function oauthStart(returnTo = "/"): string {
  return `${API_BASE}/auth/idaas/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function oauthRequest(action: string): Promise<Record<string, unknown>> {
  return api.post<Record<string, unknown>>(
    `/auth/idaas/${action}`,
    {},
    {
      credentials: "same-origin",
      headers: { "X-CoreGenie-OAuth": "1" },
      defaultError: "Authentication unavailable",
    }
  );
}
