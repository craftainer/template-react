// Talks to the backend exclusively through the BFF's same-origin `/api/crud`
// mount -- the Vite dev server proxies it to the dev BFF in development
// (vite.config.ts) and the BFF itself serves the app in the image -- so this
// client never needs the backend's own origin, holds no token (the session is
// an HttpOnly cookie) and the backend never needs CORS configured for this app.
import { CSRF_HEADER, CSRF_VALUE, redirectToLogin } from "../auth/bff";
import { API_PREFIX } from "./sdk";

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

/**
 * Fetch `path` (relative to `/api/crud`) with the session cookie and
 * `X-CSRF`, parsing a JSON response. A 401 means the session ended: it
 * navigates to login unless `redirectOnUnauthorized` is false (a probe that
 * must work signed out).
 */
export async function apiFetch<T>(
  path: string,
  options: { init?: RequestInit; redirectOnUnauthorized?: boolean } = {},
): Promise<T> {
  const { init, redirectOnUnauthorized = true } = options;
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set(CSRF_HEADER, CSRF_VALUE);
  if (init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (response.status === 401 && redirectOnUnauthorized) redirectToLogin();

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
