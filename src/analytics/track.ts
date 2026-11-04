// SPA analytics (interfaces I2/I3): `track()` posts one event to the BFF's
// `POST /bff/analytics`, which owns every privacy decision (GPC/DNT, the
// consent cookie, the allowlist, the visitor token). The browser sends no
// identifier of its own: no id, no title, no referrer, no query string, and
// only the cookies the BFF itself set for this origin. It is fire-and-forget
// and fails closed: it never throws into the UI, never retries, and after a
// transport-level failure it stays quiet for a cool-down.
import { CSRF_HEADER, CSRF_VALUE } from "../auth/bff";

export const ANALYTICS_PATH = "/bff/analytics";

/** I3: dotted lower-case segments, at most 50 characters. */
export const EVENT_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const MAX_NAME_LENGTH = 50;
const MAX_VALUE_LENGTH = 200;
const MAX_URL_LENGTH = 500;
/** Quiet period after the endpoint failed or throttled us. */
export const COOLDOWN_MS = 5 * 60_000;

export type PropValue = string | number | boolean;
export type EventProps = Readonly<Record<string, PropValue>>;

type Fetch = typeof fetch;

export interface TrackerOptions {
  readonly fetchImpl?: Fetch;
  readonly now?: () => number;
  readonly cooldownMs?: number;
  /** True when the browser asks not to be measured (GPC / DNT). */
  readonly optedOut?: () => boolean;
}

/** `navigator.globalPrivacyControl` or Do Not Track: skip the request at all. */
export function browserOptedOut(): boolean {
  const nav = globalThis.navigator as
    (Navigator & { globalPrivacyControl?: boolean }) | undefined;
  if (!nav) return false;
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** `url` as a bare path: query and fragment stripped, `/` if it is not one. */
export function pathOnly(url: string): string {
  if (!url.startsWith("/") || url.startsWith("//")) return "/";
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  return path.slice(0, MAX_URL_LENGTH) || "/";
}

function cleanProps(props: EventProps | undefined): EventProps | undefined {
  if (!props) return undefined;
  const out: Record<string, PropValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "string") out[key] = value.slice(0, MAX_VALUE_LENGTH);
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
    // anything else (objects, null, NaN) is dropped, never serialised
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createTracker(options: TrackerOptions = {}) {
  const fetchImpl: Fetch =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  const optedOut = options.optedOut ?? browserOptedOut;
  let quietUntil = 0;

  /**
   * Records `name` (I3). Returns nothing and never throws: an invalid name,
   * a browser opt-out, a cool-down or any failure just means no event.
   */
  function track(name: string, props?: EventProps, url?: string): void {
    try {
      if (name.length > MAX_NAME_LENGTH || !EVENT_NAME.test(name)) return;
      if (optedOut() || now() < quietUntil) return;

      const body: {
        name: string;
        props?: EventProps;
        url?: string;
      } = { name };
      const clean = cleanProps(props);
      if (clean) body.props = clean;
      if (url !== undefined) body.url = pathOnly(url);

      fetchImpl(ANALYTICS_PATH, {
        method: "POST",
        keepalive: true,
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER]: CSRF_VALUE,
        },
        body: JSON.stringify(body),
      })
        .then((response) => {
          // 202 is both "recorded" and "dropped by policy"; either way done.
          if (response.status === 202 || response.ok) return;
          // A 400 means this one event was malformed: drop it, keep going.
          // Anything else (429, 403, 413, 5xx) means stop for a while.
          if (response.status !== 400) quietUntil = now() + cooldownMs;
        })
        .catch(() => {
          quietUntil = now() + cooldownMs;
        });
    } catch {
      // never into the UI
    }
  }

  return { track };
}

const defaultTracker = createTracker();

/** `track(name, props?, url?)` against this page's BFF. */
export const track = defaultTracker.track;
