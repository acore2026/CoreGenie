import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

export async function authConfig() {
  const response = await fetch(`${API_BASE}/auth/config`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Authentication unavailable");
  return response.json();
}

export function oauthStart(returnTo = "/") {
  return `${API_BASE}/auth/idaas/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function oauthRequest(action) {
  const response = await fetch(`${API_BASE}/auth/idaas/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...baseHeaders(),
      "X-CoreGenie-OAuth": "1",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) throw new Error("Authentication unavailable");
  return response.json();
}
