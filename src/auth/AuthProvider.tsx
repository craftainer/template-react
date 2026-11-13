// Asks the BFF who is signed in (`GET /bff/user`) once on mount. A 401, or an
// unreachable BFF, means signed out; the sign-in button is a top-level
// navigation to `/bff/login`.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthContext, type AuthValue } from "./authContext";
import { fetchUser, logout, redirectToLogin, type BffUser } from "./bff";
import { runTeardown } from "./teardown";
import { clearBounce } from "./unauthorized";

type Session =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly user: BffUser | null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchUser()
      .catch(() => null)
      .then((user) => {
        if (!cancelled) setSession({ status: "done", user });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthValue>(() => {
    const user = session.status === "done" ? session.user : null;
    return {
      isLoading: session.status === "loading",
      isAuthenticated: user !== null,
      user,
      // A deliberate sign-in starts a fresh bounce budget (see unauthorized.ts).
      login: () => {
        clearBounce();
        redirectToLogin();
      },
      // The cache and any event streams belong to this user: drop them once the
      // BFF has ended the session, before leaving the page.
      logout: () =>
        logout(undefined, undefined, async () => {
          await runTeardown();
          clearBounce();
        }),
    };
  }, [session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
