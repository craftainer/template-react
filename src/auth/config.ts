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

/** The BFF's public config, `{}` when it cannot be read (the app still works). */
export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<RuntimeConfig> {
  try {
    const response = await fetchImpl("/bff/config", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return {};
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as RuntimeConfig)
      : {};
  } catch {
    return {};
  }
}
