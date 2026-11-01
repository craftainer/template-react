// The visitor's analytics choice lives in the BFF's HttpOnly cookie
// `__Host-Http-consent`; the SPA only reads and sets it over `/bff/consent`.
// `granted` is `true` only when the BFF says consent was given, `false` when
// it says it was not (declined, or never asked: under `implied` consent the
// BFF still records unless the choice is a decline) and `null` while unknown
// or after any failure. Callers treat `null` like `false` -- nothing is
// retried and nothing else is sent.
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
 * The stored choice (one `GET` on mount, no polling or retry) and a setter
 * that stores a new one. After a failed save the state is `null` again: the
 * cookie's value is then unknown.
 */
export function useConsent(fetchImpl: Fetch = defaultFetch) {
  const [granted, setGranted] = useState<boolean | null>(null);
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
      if (!settled.current) setGranted(value);
    });
    return () => {
      settled.current = true;
    };
  }, [fetchImpl]);

  const choose = useCallback(
    async (analytics: boolean) => {
      settled.current = true;
      const stored = await saveConsent(analytics, fetchImpl);
      if (mounted.current) setGranted(stored);
      return stored;
    },
    [fetchImpl],
  );

  return { granted, choose };
}
