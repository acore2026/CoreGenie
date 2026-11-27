import { API_BASE } from "./constants";
import { baseHeaders } from "./request";
import { createApiClient, ApiError } from "./apiClient";

export { ApiError, cleanHeaders, createApiClient } from "./apiClient";
export type { ApiRequestOptions, ApiClientConfig } from "./apiClient";

export const api = createApiClient({
  apiBase: API_BASE,
  getHeaders: () => ({ ...baseHeaders() }),
});

export function errorMessage(
  error: unknown,
  fallback = "Request failed."
): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}
