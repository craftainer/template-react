// End-to-end tests of the production topology (ADR 0007): the built SPA served
// by the BFF (`bff/src/main.ts`), signing in through a real Keycloak, with
// sessions in a real Valkey and the proxy in front of a real template-fastapi.
// Run through tests/e2e/run.sh, which hands in the lane's addresses
// (tests/e2e/README.md).
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { MAIN, SHORT, laneEnv, REALM_URL } from "./lane";

const root = resolve(import.meta.dirname, "../..");

/** Environment of a BFF process: the dev realm's `bff` client, the lane's Valkey and API. */
function bffEnv(server: { origin: string; port: number }, extra: object = {}) {
  return {
    PUBLIC_ORIGIN: server.origin,
    BFF_PORT: String(server.port),
    BFF_HOST: "0.0.0.0",
    BFF_STATIC_DIR: resolve(root, "dist"),
    // Keycloak is `localhost:8080` for the browser, the tokens' `iss` and
    // this process alike (shared network namespace).
    OIDC_ISSUER: REALM_URL,
    OIDC_DISCOVERY_URL: `${REALM_URL}/.well-known/openid-configuration`,
    OIDC_CLIENT_SECRET:
      process.env.E2E_BFF_CLIENT_SECRET ?? "dev-only-bff-client-secret",
    OIDC_ALLOW_INSECURE: "true",
    BFF_UPSTREAMS: JSON.stringify({
      crud: {
        url: laneEnv("E2E_API_URL"),
        audience: "api",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      },
    }),
    SESSION_STORE_URL: laneEnv("E2E_SESSION_STORE_URL"),
    SESSION_STORE_ALLOW_PLAINTEXT: "true",
    // Many logins and events per minute from one address.
    RATE_LIMIT_MAX: "10000",
    ANALYTICS_BACKEND: "log",
    ANALYTICS_PROP_KEYS: "powers_count",
    ...extra,
  };
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "../../test-results",
  globalSetup: "./global-setup.ts",
  // The specs share one Keycloak and one Valkey; run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A loaded host (Keycloak, Chromium and a Vite bundle on a few cores) is slow.
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../playwright-report", open: "never" }],
  ],
  use: {
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "main",
      testIgnore: "expiry.e2e.ts",
      use: { baseURL: MAIN.origin },
    },
    {
      name: "expiry",
      testMatch: "expiry.e2e.ts",
      use: { baseURL: SHORT.origin },
    },
  ],
  webServer: [
    {
      // stdout/stderr go to a file the specs read (analytics events and
      // security events are log lines).
      command: `node bff/src/main.ts > ${MAIN.log} 2>&1`,
      cwd: root,
      url: `${MAIN.origin}/health/live`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: bffEnv(MAIN, {
        SECURITY_TXT_CONTACT: "mailto:security@example.invalid",
        CHANGE_PASSWORD_URL: `${REALM_URL}/account/`,
      }),
    },
    {
      command: `node bff/src/main.ts > ${SHORT.log} 2>&1`,
      cwd: root,
      url: `${SHORT.origin}/health/live`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: bffEnv(SHORT, {
        SESSION_IDLE_SECONDS: String(SHORT.idleSeconds),
        SESSION_ABSOLUTE_SECONDS: String(SHORT.absoluteSeconds),
      }),
    },
  ],
});
