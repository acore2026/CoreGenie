import { API_BASE } from "@/utils/constants";
import { api } from "@/utils/api";

import type { StoredUser } from "@/utils/request";
export type AuthProvider = "local" | "idaas";
interface OAuthSession {
  valid: boolean;
  token: string;
  user: StoredUser;
  returnTo?: string;
}
export function authConfig() {
  return api.get<{ provider: AuthProvider }>("/auth/config", {
    auth: false,
    cache: "no-store",
    defaultError: "Authentication unavailable",
  });
}

export function oauthStart(returnTo = "/"): string {
  return `${API_BASE}/auth/idaas/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function oauthRequest(action: "session"): Promise<OAuthSession>;
export function oauthRequest(action: "logout"): Promise<{ success: boolean }>;
export function oauthRequest(action: "session" | "logout") {
  return api.post<OAuthSession | { success: boolean }>(
    `/auth/idaas/${action}`,
    {},
    {
      credentials: "same-origin",
      headers: { "X-CoreGenie-OAuth": "1" },
      defaultError: "Authentication unavailable",
    }
  );
}
