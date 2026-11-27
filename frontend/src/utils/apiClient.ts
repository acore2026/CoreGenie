export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string | null | undefined>;
  auth?: boolean;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  defaultError?: string;
}

export interface ApiClientConfig {
  apiBase: string;
  getHeaders: () => Record<string, string | null | undefined>;
  fetchImpl?: typeof fetch;
}

export function cleanHeaders(
  headers: Record<string, string | null | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== null && value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string" && record.error) return record.error;
    if (typeof record.reason === "string" && record.reason)
      return record.reason;
    if (typeof record.message === "string" && record.message)
      return record.message;
  }
  return fallback;
}

export function createApiClient({
  apiBase,
  getHeaders,
  fetchImpl = fetch,
}: ApiClientConfig) {
  async function request<T = unknown>(
    path: string,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const {
      method = "GET",
      body,
      headers = {},
      auth = true,
      cache,
      credentials,
      signal,
      defaultError = "Request failed.",
    } = options;

    const url = /^https?:\/\//i.test(path) ? path : `${apiBase}${path}`;
    const sendingFormData = isFormData(body);
    const hasJsonBody = body !== undefined && !sendingFormData;

    const mergedHeaders = cleanHeaders({
      ...(auth ? getHeaders() : {}),
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    });

    const requestBody: BodyInit | undefined = sendingFormData
      ? body
      : hasJsonBody
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined;

    const response = await fetchImpl(url, {
      method,
      headers: mergedHeaders,
      ...(requestBody !== undefined ? { body: requestBody } : {}),
      ...(cache !== undefined ? { cache } : {}),
      ...(credentials !== undefined ? { credentials } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(
        extractErrorMessage(data, defaultError),
        response.status,
        data
      );
    }
    return data as T;
  }

  return {
    request,
    get: <T = unknown>(
      path: string,
      options?: Omit<ApiRequestOptions, "method" | "body">
    ) => request<T>(path, { ...options, method: "GET" }),
    post: <T = unknown>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, "method" | "body">
    ) => request<T>(path, { ...options, method: "POST", body }),
    put: <T = unknown>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, "method" | "body">
    ) => request<T>(path, { ...options, method: "PUT", body }),
    patch: <T = unknown>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, "method" | "body">
    ) => request<T>(path, { ...options, method: "PATCH", body }),
    delete: <T = unknown>(
      path: string,
      body?: unknown,
      options?: Omit<ApiRequestOptions, "method" | "body">
    ) => request<T>(path, { ...options, method: "DELETE", body }),
  };
}
