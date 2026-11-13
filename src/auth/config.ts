// Public runtime config from the BFF (`GET /bff/config`), replacing the old
// build-time OIDC env and `/config.js`: the SPA holds no identity-provider
// settings any more, since the BFF does the login.
import { createContext, useContext } from "react";

/** The members of `/bff/config` the SPA reads; unknown members are ignored. */
export interface RuntimeConfig {
  readonly [key: string]: unknown;
}

export const RuntimeConfigContext = createContext<RuntimeConfig>({});

/** The config loaded at startup (`{}` outside a provider, as in tests). */
export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}

/** How long startup waits for `/bff/config`; the page must not stay blank. */
export const CONFIG_TIMEOUT_MS = 5_000;

/**
 * The BFF's public config, `{}` when it cannot be read within
 * `CONFIG_TIMEOUT_MS` (the app still works, with the feature flags it reads
 * off: no analytics banner).
 */
export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  timeoutMs: number = CONFIG_TIMEOUT_MS,
): Promise<RuntimeConfig> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/bff/config", {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: abort.signal,
    });
    if (!response.ok) return {};
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as RuntimeConfig)
      : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
