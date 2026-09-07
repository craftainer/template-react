/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Set by /config.js in the built production image -- see docs/adrs/0002-same-origin-api-proxy.md. */
interface AppConfig {
  readonly oidcAuthority?: string;
  readonly oidcClientId?: string;
}

interface Window {
  __APP_CONFIG__?: AppConfig;
}
