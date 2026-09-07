// OIDC settings. window.__APP_CONFIG__ (set by /config.js, generated from
// real container env vars at container start -- see
// docs/adrs/0002-same-origin-api-proxy.md's "Runtime-configurable
// production image") takes precedence so the built production image can
// point at a different realm/client without a rebuild; Vite's own
// build-time env vars are the dev fallback (no config.js there) -- see
// docs/adrs/0001-oidc-auth-matching-the-backend.md.
import type { AuthProviderProps } from "react-oidc-context";

const authority =
  window.__APP_CONFIG__?.oidcAuthority ??
  import.meta.env.VITE_OIDC_AUTHORITY ??
  "http://localhost:8080/realms/template-fastapi";
const clientId =
  window.__APP_CONFIG__?.oidcClientId ??
  import.meta.env.VITE_OIDC_CLIENT_ID ??
  "api";

export const oidcConfig: AuthProviderProps = {
  authority,
  client_id: clientId,
  redirect_uri: window.location.origin,
  post_logout_redirect_uri: window.location.origin,
  scope: "openid profile",
  automaticSilentRenew: true,
  onSigninCallback: () => {
    // Strips the `code`/`state` query params Keycloak appends to the redirect
    // URI, so a page refresh doesn't try to replay the same auth code.
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};
