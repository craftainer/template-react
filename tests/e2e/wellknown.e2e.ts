// The BFF's /.well-known/* endpoints and its public config, as a browser or a
// crawler sees them (no session, no X-CSRF: they are all GETs). The lane
// configures SECURITY_TXT_CONTACT and CHANGE_PASSWORD_URL (playwright.config.ts).
import { expect, test } from "@playwright/test";
import { MAIN, REALM_URL } from "./lane";

test("security.txt (RFC 9116)", async ({ request }) => {
  const response = await request.get("/.well-known/security.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const body = await response.text();
  expect(body).toContain("Contact: mailto:security@example.invalid\n");
  expect(body).toContain(
    `Canonical: ${MAIN.origin}/.well-known/security.txt\n`,
  );
  const expires = /^Expires: (.+)$/m.exec(body)?.[1];
  expect(expires, "an Expires field").toBeDefined();
  expect(Date.parse(expires!)).toBeGreaterThan(Date.now());
  // RFC 9116 section 2.5.5: less than a year ahead.
  expect(Date.parse(expires!)).toBeLessThan(Date.now() + 366 * 86_400_000);

  expect((await request.head("/.well-known/security.txt")).status()).toBe(200);
});

test("change-password redirects to the identity provider's account page", async ({
  request,
}) => {
  const response = await request.get("/.well-known/change-password", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe(`${REALM_URL}/account/`);
});

test("gpc.json declares that Global Privacy Control is honoured", async ({
  request,
}) => {
  const response = await request.get("/.well-known/gpc.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({
    gpc: true,
    lastUpdate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});

test("api-catalog (RFC 9727) lists the crud upstream", async ({ request }) => {
  const response = await request.get("/.well-known/api-catalog");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain(
    "application/linkset+json",
  );
  expect(response.headers().link).toContain('rel="api-catalog"');
  expect(await response.json()).toEqual({
    linkset: [
      {
        anchor: `${MAIN.origin}/.well-known/api-catalog`,
        item: [{ href: `${MAIN.origin}/api/crud/`, title: "crud" }],
        "api-catalog": [
          {
            href: `${MAIN.origin}/api/crud/.well-known/api-catalog`,
            title: "crud",
          },
        ],
      },
    ],
  });
});

test("an unknown well-known path is a JSON 404, not the app", async ({
  request,
}) => {
  const response = await request.get("/.well-known/nothing-here");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
});

test("/bff/config and the health endpoints", async ({ request }) => {
  const config = await request.get("/bff/config");
  expect(config.status()).toBe(200);
  expect(await config.json()).toEqual({
    analytics: { enabled: true, consent: "implied", respectGpc: true },
    upstreams: ["crud"],
  });

  expect((await request.get("/health/live")).status()).toBe(200);
  // Ready needs the real Valkey and a reachable Keycloak discovery document.
  const ready = await request.get("/health/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({
    status: "ok",
    checks: { store: expect.anything(), idp: expect.anything() },
  });
});
