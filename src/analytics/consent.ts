// The visitor's analytics choice lives in the BFF's HttpOnly cookie
// `__Host-Http-consent`; the SPA only reads and sets it over `/bff/consent`.
// `granted` is `true` only when the BFF says consent was given, `false` when
// it says it was not (declined, or never asked: under `implied` consent the
// BFF still records unless the choice is a decline) and `null` while unknown
// while the first read is pending or after it failed. Callers treat `null`
// like `false` -- nothing is retried and nothing else is sent.
import { useCallback, useEffect, useRef, useState } from "react";
import { CSRF_HEADER, CSRF_VALUE } from "../auth/bff";

export const CONSENT_PATH = "/bff/consent";

type Fetch = typeof fetch;
const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

async function readAnswer(response: Response): Promise<boolean | null> {
  if (!response.ok) return null;
  const body = (await response.json()) as { analytics?: unknown };
  return typeof body.analytics === "boolean" ? body.analytics : null;
}

/** `GET /bff/consent`: the current choice, `null` on any failure. */
export async function fetchConsent(
  fetchImpl: Fetch = defaultFetch,
): Promise<boolean | null> {
  try {
    return await readAnswer(
      await fetchImpl(CONSENT_PATH, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    );
  } catch {
    return null;
  }
}

/** `POST /bff/consent {analytics}`: the stored choice, `null` on any failure. */
export async function saveConsent(
  analytics: boolean,
  fetchImpl: Fetch = defaultFetch,
): Promise<boolean | null> {
  try {
    return await readAnswer(
      await fetchImpl(CONSENT_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [CSRF_HEADER]: CSRF_VALUE,
        },
        body: JSON.stringify({ analytics }),
      }),
    );
  } catch {
    return null;
  }
}

/**
 * The BFF cannot tell "never asked" from "declined" (`GET /bff/consent` is
 * `{analytics: false}` for both), so a browser that has been asked remembers
 * only that fact, to not ask again on every visit. It is a flag, not the
 * choice: the choice stays in the BFF's cookie, which is what counts.
 */
export const ANSWERED_KEY = "analytics.consent.answered";

type Flag = Pick<Storage, "getItem" | "setItem">;
function localFlag(): Flag | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when this browser was asked and stored an answer. Unreadable: not asked. */
export function hasAnswered(store: Flag | null = localFlag()): boolean {
  try {
    return store?.getItem(ANSWERED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers that the visitor was asked (best effort; they are asked again if it fails). */
export function markAnswered(store: Flag | null = localFlag()): void {
  try {
    store?.setItem(ANSWERED_KEY, "1");
  } catch {
    // asked again next visit
  }
}

/**
 * The stored choice (one `GET` on mount, no polling or retry), `ready` once
 * that read has settled, and a setter that stores a new one. A failed save
 * leaves the state as it was (the cookie still holds the previous value) and
 * returns `null`, so the caller can say it failed.
 */
export function useConsent(fetchImpl: Fetch = defaultFetch) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  // Set once the visitor chose (or unmounted): a slower mount-time GET must
  // not overwrite what they just stored.
  const settled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    settled.current = false;
    void fetchConsent(fetchImpl).then((value) => {
      if (settled.current) return;
      setGranted(value);
      setReady(true);
    });
    return () => {
      settled.current = true;
    };
  }, [fetchImpl]);

  const choose = useCallback(
    async (analytics: boolean) => {
      settled.current = true;
      const stored = await saveConsent(analytics, fetchImpl);
      if (mounted.current) {
        // The mount-time read is ignored from here on, so `ready` is set now.
        if (stored !== null) setGranted(stored);
        setReady(true);
      }
      return stored;
    },
    [fetchImpl],
  );

  return { granted, ready, choose };
}
