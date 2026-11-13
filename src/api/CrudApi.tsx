// React side of src/api/sdk.ts: builds the SDK client once per signed-in
// user, waits for the manifest, then provides it to @craftainer/crud-views.
// A client is never built without the user's `sub` (the cache scope), and its
// cache and the query cache are cleared when the user changes or signs out.
import { useEffect, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { QueryClient } from "@tanstack/react-query";
import { CrudProvider } from "@craftainer/crud-views";
import { useAuth } from "../auth/authContext";
import { registerTeardown } from "../auth/teardown";
import { bounceToLogin, clearBounce } from "../auth/unauthorized";
import { CrudApiContext } from "./crudApiContext";
import { createCrudApi, type CrudApi } from "./sdk";

/** Clears everything cached for the user these belong to. */
async function clearUserData(api: CrudApi, queryClient: QueryClient) {
  queryClient.clear();
  // Both run even if one fails: a cache that cannot be closed must still be emptied.
  await api.cache.close().catch(() => undefined);
  await api.cache.clear();
}

export function CrudApiProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const sub = auth.user?.sub;

  const [queryClient] = useState(() => new QueryClient());
  // The client is tied to the `sub` it was built for: after a user change the
  // old one is never handed out, even for a render.
  const [created, setCreated] = useState<{
    readonly sub: string;
    readonly api: CrudApi;
  } | null>(null);
  const api = created && created.sub === sub ? created.api : null;
  const [error, setError] = useState<Error | null>(null);
  // Set when the login bounce already happened once and a 401 came back: the
  // user is signed in but this app's API refuses them.
  const [forbidden, setForbidden] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // No `sub`, no scope: do not build a cached client (fail closed).
    if (!sub) return;
    let cancelled = false;
    createCrudApi({
      cacheScope: sub,
      // A final 401 means the session ended: sign in again, once. A second
      // one is an authorisation problem, not an expiry (src/auth/unauthorized.ts).
      onUnauthorized: (_response, info) => {
        if (bounceToLogin(info) === "blocked" && !cancelled) setForbidden(true);
      },
    })
      .then((built) => {
        if (cancelled) {
          void clearUserData(built, queryClient);
          return;
        }
        clearBounce();
        setForbidden(false);
        setCreated({ sub, api: built });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, sub, queryClient]);

  // The cache and the query cache hold this user's records: clear them when
  // the user changes, on unmount, and (through the registry) on logout.
  useEffect(() => {
    if (!api) return;
    const teardown = () => clearUserData(api, queryClient);
    const unregister = registerTeardown(teardown);
    return () => {
      unregister();
      void teardown();
    };
  }, [api, queryClient]);

  if (!sub) {
    return (
      <Alert severity="error">
        Your sign-in did not include an identity, so the API was not loaded.
        Sign out and sign in again.
      </Alert>
    );
  }
  if (forbidden) {
    return (
      <Alert
        severity="error"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              clearBounce();
              auth.login();
            }}
          >
            Sign in again
          </Button>
        }
      >
        You are signed in, but not authorised to use this app&rsquo;s API. Ask
        an administrator for access, or sign in with another account.
      </Alert>
    );
  }
  if (error) {
    return (
      <Alert
        severity="error"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        }
      >
        Could not load the API: {error.message}
      </Alert>
    );
  }
  if (!api) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    );
  }
  return (
    <CrudApiContext.Provider value={api}>
      <CrudProvider client={api.client} queryClient={queryClient} scope={sub}>
        {children}
      </CrudProvider>
    </CrudApiContext.Provider>
  );
}
