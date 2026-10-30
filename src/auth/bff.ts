// The SPA's side of the BFF session (interface I2): the browser holds only an
// HttpOnly session cookie, so there is no token here. `GET /bff/user` says who
// is signed in, login is a top-level navigation and logout is a CSRF-guarded
// POST. See docs/plans/2026-10-bff-wellknown-analytics-owasp.md (I2).

/** Sent on every `/api/*` request and every non-GET `/bff/*` request. */
export const CSRF_HEADER = "X-CSRF";
export const CSRF_VALUE = "1";

/** `GET /bff/user` on a live session. `roles` is for the UI only. */
export interface BffUser {
  readonly sub: string;
  readonly name: string;
  readonly email?: string | undefined;
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly expiresAt: number | string;
}

type Fetch = typeof fetch;
type Assign = (url: string) => void;

const assign: Assign = (url) => window.location.assign(url);

/**
 * `returnTo` as a same-origin path (with query and fragment), or `/` for
 * anything else: an absolute or protocol-relative URL, a backslash trick, a
 * `javascript:` URL.
 */
export function safeReturnTo(
  value: string | null | undefined,
  origin: string = window.location.origin,
): string {
  if (!value || !value.startsWith("/") || /^\/[/\\]/.test(value)) return "/";
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

/** The path the user is on now, to come back to after login. */
function currentPath(): string {
  const { pathname, search, hash } = window.location;
  return safeReturnTo(`${pathname}${search}${hash}`);
}

/** `/bff/login?returnTo=<same-origin path>`. */
export function loginUrl(returnTo: string = currentPath()): string {
  return `/bff/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/** Top-level navigation to login (no `X-CSRF`: it is not a fetch). */
export function redirectToLogin(
  returnTo?: string,
  navigate: Assign = assign,
): void {
  navigate(loginUrl(returnTo));
}

/** The signed-in user, `null` on a `401`; any other failure throws. */
export async function fetchUser(
  fetchImpl: Fetch = (input, init) => globalThis.fetch(input, init),
): Promise<BffUser | null> {
  const response = await fetchImpl("/bff/user", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`GET /bff/user failed with status ${response.status}`);
  }
  return (await response.json()) as BffUser;
}

/**
 * Ends the session (`POST /bff/logout`) and returns the identity provider's
 * `logoutUrl`, which the caller navigates to.
 */
export async function requestLogout(
  fetchImpl: Fetch = (input, init) => globalThis.fetch(input, init),
): Promise<string> {
  const response = await fetchImpl("/bff/logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", [CSRF_HEADER]: CSRF_VALUE },
  });
  if (!response.ok) {
    throw new Error(`POST /bff/logout failed with status ${response.status}`);
  }
  const body = (await response.json()) as { logoutUrl?: unknown };
  const href = httpUrl(body.logoutUrl);
  if (href === null) {
    throw new Error("POST /bff/logout returned no usable logoutUrl");
  }
  return href;
}

/** `value` as an absolute http(s) URL, else `null` (never a `javascript:` URL). */
function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Logs out and navigates to the identity provider's logout page. */
export async function logout(
  fetchImpl?: Fetch,
  navigate: Assign = assign,
): Promise<void> {
  navigate(await requestLogout(fetchImpl));
}
