import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Same-origin /api proxy: the backend never needs CORS configured, and the
  // app never needs to know its own origin at build time -- see
  // docs/adrs/0002-same-origin-api-proxy.md. VITE_API_PROXY_TARGET defaults
  // to host.docker.internal, reaching the sibling backend repo's own
  // devcontainer via its forwarded port 8000 (see compose.yml's extra_hosts
  // and README.md's "Connecting to the backend") -- override in .env for a
  // backend run directly on the host instead of in its own devcontainer.
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET || "http://host.docker.internal:8000";

  return {
    plugins: [react()],
    // Static assets live under src/ alongside the rest of the app rather
    // than at the project root (Vite's default `public/`).
    publicDir: "src/public",
    server: {
      host: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
