/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev only: where `vite` proxies /bff, /api and /.well-known (the dev BFF). */
  readonly VITE_BFF_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
