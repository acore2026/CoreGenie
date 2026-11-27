import { AUTH_TOKEN, AUTH_USER } from "./constants";

export interface StoredUser {
  id?: number;
  username?: string;
  role?: string;
  [key: string]: unknown;
}

export interface RequestBaseHeaders {
  Authorization: string | null;
  "X-Timezone": string;
  "X-Language": string;
}

// Sets up the base headers for all authenticated requests so that we are able to prevent
// basic spoofing since a valid token is required and that cannot be spoofed
export function userFromStorage(): StoredUser | null {
  const userString = window.localStorage.getItem(AUTH_USER);
  if (!userString) return null;
  return safeJsonParse<StoredUser | null>(userString, null);
}

export function baseHeaders(
  providedToken: string | null = null
): RequestBaseHeaders {
  const token = providedToken || window.localStorage.getItem(AUTH_TOKEN);
  return {
    Authorization: token ? `Bearer ${token}` : null,
    "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    "X-Language": navigator.language || "en",
  };
}

export function safeJsonParse<T = any>(
  jsonString: string | null | undefined,
  fallback: T = null as T
): T {
  try {
    if (jsonString === null || jsonString === undefined) return fallback;
    return JSON.parse(jsonString) as T;
  } catch {}
  return fallback;
}
