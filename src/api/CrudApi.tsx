// React side of src/api/sdk.ts: builds the SDK client once per signed-in
// session, waits for the manifest, then provides it to @craftainer/crud-views.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { QueryClient } from "@tanstack/react-query";
import { CrudProvider } from "@craftainer/crud-views";
import { useAuth } from "react-oidc-context";
import { CrudApiContext } from "./crudApiContext";
import { createCrudApi, type CrudApi } from "./sdk";

export function CrudApiProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  // The token provider reads the latest session without rebuilding the client.
  const session = useRef(auth);
  useEffect(() => {
    session.current = auth;
  });

  const [queryClient] = useState(() => new QueryClient());
  const [api, setApi] = useState<CrudApi | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    createCrudApi({
      getToken: async ({ refresh }) => {
        if (refresh) {
          const user = await session.current.signinSilent();
          return user?.access_token;
        }
        return session.current.user?.access_token;
      },
    })
      .then((created) => {
        if (!cancelled) setApi(created);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Alert severity="error">Could not load the API: {error.message}</Alert>
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
      <CrudProvider
        client={api.client}
        queryClient={queryClient}
        scope={auth.user?.profile.sub}
      >
        {children}
      </CrudProvider>
    </CrudApiContext.Provider>
  );
}
