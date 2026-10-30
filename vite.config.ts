import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Same-origin proxy to the dev BFF, which owns /bff (login, session, config),
  // /api/<upstream> (the allowlisted proxy to the backend) and /.well-known:
  // the backend never needs CORS configured, and the app never needs to know
  // its own origin at build time. The BFF reaches the sibling backend itself
  // (BFF_UPSTREAMS). VITE_BFF_PROXY_TARGET overrides the dev BFF address.
  const bffProxyTarget = env.VITE_BFF_PROXY_TARGET || "http://localhost:8787";

  return {
    plugins: [react()],
    // Static assets live under src/ alongside the rest of the app rather
    // than at the project root (Vite's default `public/`).
    publicDir: "src/public",
    server: {
      host: true,
      // The app is same-origin with its /api proxy, so it needs no CORS, and
      // Vite's default CORS middleware adds `Vary: Origin` to every response
      // (proxied ones too), which makes @craftainer/crud-sdk's cache refuse
      // to store records -- no ETag, so no conditional save. `preview.cors`
      // follows this. See docs/adrs/0006-manifest-driven-admin.md.
      cors: false,
      // The BFF checks Origin against PUBLIC_ORIGIN (the Vite origin in dev),
      // so the Host/Origin headers pass through unchanged: no `changeOrigin`.
      proxy: {
        "/bff": bffProxyTarget,
        "/api": bffProxyTarget,
        "/.well-known": bffProxyTarget,
      },
    },
    // Stated outright although it defaults to `server.cors`: the e2e serves
    // the built bundle with `vite preview` and needs ETags to be stored.
    preview: { cors: false },
  };
});
