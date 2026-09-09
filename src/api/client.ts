// Talks to the backend exclusively via the same-origin `/api` path -- the Vite
// dev server proxies it in development (vite.config.ts) and nginx proxies it
// in the runner image (scripts/docker/nginx.conf.template), so this client never needs
// the backend's own origin and the backend never needs CORS configured for
// this app. See docs/adrs/0002-same-origin-api-proxy.md.

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Fetch `path` (relative to `/api`) with an optional bearer token, parsing a JSON response. */
export async function apiFetch<T>(
  path: string,
  options: { accessToken?: string; init?: RequestInit } = {},
): Promise<T> {
  const { accessToken, init } = options;
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`/api${path}`, { ...init, headers });

  if (!response.ok) {
    // RFC 9457 Problem Details -- see the backend's app.problem_details.
    const detail = await response.json().catch(() => null);
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
