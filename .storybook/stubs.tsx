// Stubs for stories: a fake signed-in/out BFF session and a fake backend,
// both chosen per story through `parameters` (see preview.tsx). Stories never
// touch Keycloak or the real API, so every render is deterministic.
import type { ReactNode } from "react";
import { AuthContext, type AuthValue } from "../src/auth/authContext";
import type { Hero } from "../src/api/heroes";

export type AuthState = "signedOut" | "signedIn" | "loading";

export interface ApiStub {
  /** `GET /api/crud/health/live`: "pending" never answers (the "checking" state). */
  health?: "up" | "down" | "pending";
  /** `GET` of the heroes list: rows, "pending" (loading) or an HTTP error. */
  heroes?: Hero[] | "pending" | { status: number; detail: string };
}

/** What a story may set in `parameters`; preview.tsx reads both. */
export interface StubParameters {
  auth?: AuthState;
  api?: ApiStub;
}

/** Two fixed heroes (stable ids and dates: screenshots must not drift). */
const base = {
  owner_id: "stub-owner",
  is_draft: false,
  archived_at: null,
  publish_at: null,
  unpublish_at: null,
  is_locked: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
export const heroFixtures: Hero[] = [
  {
    ...base,
    id: 1,
    name: "Captain Ledger",
    powers: ["Foresight", "Filing"],
    power_level: 72,
  },
  {
    ...base,
    id: 2,
    name: "The Margin",
    powers: ["Annotation"],
    power_level: 41,
  },
  {
    ...base,
    id: 3,
    name: null,
    powers: null,
    power_level: null,
    is_draft: true,
  },
];

const noop = async () => undefined;

export function stubAuth(state: AuthState): AuthValue {
  const signedIn = state === "signedIn";
  return {
    isLoading: state === "loading",
    isAuthenticated: signedIn,
    user: signedIn
      ? {
          sub: "stub-sub",
          name: "ada.lovelace",
          roles: { api: ["maintainer"] },
          expiresAt: 4102444800,
        }
      : null,
    login: () => undefined,
    logout: noop,
  };
}

export function StubAuthProvider({
  state,
  children,
}: {
  state: AuthState;
  children: ReactNode;
}) {
  return (
    <AuthContext.Provider value={stubAuth(state)}>
      {children}
    </AuthContext.Provider>
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const never = () => new Promise<Response>(() => {});

/** Replaces `window.fetch` with a fake of the two endpoints the app calls. */
export function installApiStub(api: ApiStub = {}) {
  const { health = "up", heroes = [] } = api;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), window.location.origin);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.pathname === "/api/crud/health/live") {
      if (health === "pending") return never();
      return health === "up"
        ? json(200, { status: "ok" })
        : json(503, { title: "down" });
    }
    if (
      url.pathname === "/api/crud/crud/v1/heroes/v2/json" &&
      method === "GET"
    ) {
      if (heroes === "pending") return never();
      if (!Array.isArray(heroes)) {
        return json(heroes.status, { detail: heroes.detail });
      }
      return json(200, heroes);
    }
    return json(404, { title: "Not stubbed" });
  };
}
