// @vitest-environment node
import { createMemorySessionStore, loadConfig } from "@craftainer/bff";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

// Smoke test: the real library wiring, in process, with the in-memory session
// store, so no Valkey or IdP is needed (discovery and the store connection
// are lazy, and /health/live touches neither).
const config = loadConfig({
  PUBLIC_ORIGIN: "http://localhost:8080",
  OIDC_ISSUER: "http://idp.invalid/realms/test",
  OIDC_ALLOW_INSECURE: "true",
  OIDC_CLIENT_SECRET: "test-secret",
  SESSION_STORE_URL: "redis://localhost:6379",
});

describe("bff", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start() {
    const app = await buildApp(config, {
      sessionStore: createMemorySessionStore(),
      logger: false,
    });
    apps.push(app);
    return app;
  }

  it("answers /health/live", async () => {
    const app = await start();
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
  });

  it("serves the example app route", async () => {
    const app = await start();
    const res = await app.inject({ method: "GET", url: "/bff/ping" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("answers an unknown path with the library's JSON 404", async () => {
    const app = await start();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
  });
});
