// Loop guard for the "401 -> login" redirect. A final 401 from `/api/*` means
// the BFF session ended, and the app sends the browser to `/bff/login`. While
// the identity provider's own session lives that bounce is silent, so a user
// who is signed in but not authorised (audience mismatch, a role the upstream
// rejects) would loop between the SPA, the BFF and the provider forever, once
// per open tab. One bounce is allowed; a second 401 after it is an
// authorisation problem, not an expired session, and the app shows an error.
//
// The marker lives in `sessionStorage` so it survives the full-page
// navigations of the bounce and a reload. A request that succeeds clears it
// (the bounce worked); so does an explicit sign-in or sign-out.
// It holds a timestamp only, never a token or an identifier. Fail closed:
// a marker we cannot read or parse, or storage that is unavailable, counts as
// "already bounced", so the worst case is an error with a manual sign-in
// button instead of an unbounded redirect loop.
import { redirectToLogin } from "./bff";

export const BOUNCE_KEY = "bff.login-bounce";
/** A marker older than this is stale (a session that expired much later). */
export const BOUNCE_WINDOW_MS = 10 * 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** True when a login bounce already happened in this tab and may not repeat. */
export function bounceBlocked(
  now: number = Date.now(),
  store: Store | null = sessionStore(),
): boolean {
  if (!store) return true;
  try {
    const raw = store.getItem(BOUNCE_KEY);
    if (raw === null) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return true;
    return now - at < BOUNCE_WINDOW_MS;
  } catch {
    return true;
  }
}

/** Forgets the bounce: a request succeeded, or the user acted on purpose. */
export function clearBounce(store: Store | null = sessionStore()): void {
  try {
    store?.removeItem(BOUNCE_KEY);
  } catch {
    // nothing to clear
  }
}

export interface BounceDeps {
  readonly now?: () => number;
  readonly store?: Store | null;
  readonly navigate?: () => void;
}

/**
 * Handles a final 401: redirects to login once, then refuses. Returns
 * `"redirected"` or `"blocked"`; on `"blocked"` the caller shows the
 * "signed in but not authorised" error. `attempt` is the SDK's invocation
 * count: more than one means the first bounce did not help.
 */
export function bounceToLogin(
  info: { readonly attempt: number } = { attempt: 1 },
  deps: BounceDeps = {},
): "redirected" | "blocked" {
  const now = deps.now?.() ?? Date.now();
  const store = deps.store === undefined ? sessionStore() : deps.store;
  if (info.attempt > 1 || bounceBlocked(now, store) || !store) {
    return "blocked";
  }
  try {
    store.setItem(BOUNCE_KEY, String(now));
  } catch {
    return "blocked";
  }
  (deps.navigate ?? (() => redirectToLogin()))();
  return "redirected";
}
