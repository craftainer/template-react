// Asks the BFF who is signed in (`GET /bff/user`) on mount. A 401, or an
// unreachable BFF, means signed out; the sign-in button is a top-level
// navigation to `/bff/login`. The answer is asked again whenever the tab
// becomes visible, because the session cookie is shared by every tab of the
// browser: another tab may have signed in as someone else or signed out. Only
// a definite answer changes the state there (a 401 or a user); a failed
// request keeps what the tab shows, so a blip is not mistaken for a logout.
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

  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      fetchUser().then(
        (user) =>
          setSession((prev) =>
            prev.status === "done" && prev.user?.sub === user?.sub
              ? prev
              : { status: "done", user },
          ),
        () => undefined,
      );
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
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
