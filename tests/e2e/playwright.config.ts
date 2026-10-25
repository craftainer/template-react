// End-to-end tests of the admin against a running template-fastapi and its
// Keycloak (ADR 0006). Run through tests/e2e/run.sh: it uses the same pinned
// Playwright image as tests/visual, and this config starts the app's own Vite
// preview server inside it, proxying /api to the backend.
import { defineConfig } from "@playwright/test";

const PORT = 5183;
const apiTarget = process.env.E2E_API_PROXY_TARGET ?? "http://localhost:8000";
const authority =
  process.env.E2E_OIDC_AUTHORITY ??
  "http://keycloak:8080/realms/template-fastapi";

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "../../test-results",
  // One journey creates, edits and deletes records; run it alone.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../playwright-report", open: "never" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  webServer: {
    // The production bundle, served by `vite preview` (which reuses
    // vite.config.ts's /api proxy): no dependency re-optimisation on a cold
    // start, and the test runs what ships.
    command: `node_modules/.bin/vite build --logLevel warn && node_modules/.bin/vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    timeout: 600_000,
    cwd: "../..",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: {
      VITE_API_PROXY_TARGET: apiTarget,
      // The backend validates the token's issuer, so the browser must reach
      // Keycloak under the same host name the backend was configured with.
      VITE_OIDC_AUTHORITY: authority,
    },
  },
});
