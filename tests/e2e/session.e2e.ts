// The session through a real Keycloak login: the cookie, what the browser
// holds, CSRF and Origin rejections, and logout (ADR 0007, FR-0001).
import { expect, test } from "@playwright/test";
import {
  KEYCLOAK,
  MAIN,
  REALM_URL,
  HEROES,
  SESSION_COOKIE,
  idle,
  logLines,
  raw,
  sessionCookie,
  sessionId,
  setCookies,
  signInViaBff,
  storedSession,
  submitKeycloakForm,
  valkey,
} from "./lane";

test.describe("sign-in and the session cookie", () => {
  test("the callback sets a __Host- cookie that is HttpOnly, Secure and SameSite=Strict", async ({
    page,
    context,
  }) => {
    const callbacks: string[][] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/bff/callback") {
        void response
          .headersArray()
          .then((headers) =>
            callbacks.push(
              headers
                .filter((h) => h.name.toLowerCase() === "set-cookie")
                .map((h) => h.value),
            ),
          );
      }
    });

    await signInViaBff(page, MAIN.origin, "maintainer");

    // The Set-Cookie header on the callback's redirect, attribute by attribute.
    await expect.poll(() => callbacks.length).toBeGreaterThan(0);
    const header = callbacks
      .flat()
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(header, "Set-Cookie of the session").toBeDefined();
    expect(header).toMatch(/;\s*Path=\/(;|$)/i);
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*SameSite=Strict/i);
    expect(header).not.toMatch(/;\s*Domain=/i); // __Host- forbids it
    expect(header).not.toMatch(/;\s*(Max-Age|Expires)=/i); // a browser-session cookie

    // What Chromium stored: Secure is accepted on http://localhost.
    const cookie = await sessionCookie(context);
    expect(cookie).toMatchObject({
      name: SESSION_COOKIE,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      domain: "localhost",
    });
    // Opaque: 256 random bits, not a JWT or anything derived from one.
    expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the browser holds no token", async ({ page, context }) => {
    await signInViaBff(page, MAIN.origin, "maintainer");
    const id = await sessionId(context);
    const stored = await storedSession(id);
    expect(stored?.accessToken).toBeTruthy();

    const visible = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
    }));
    expect(visible.cookie).not.toContain(SESSION_COOKIE); // HttpOnly
    for (const value of Object.values(visible)) {
      expect(value).not.toContain(stored!.accessToken);
      expect(value).not.toContain(stored!.refreshToken ?? "no refresh token");
      expect(value).not.toContain("eyJ"); // no JWT anywhere
    }
  });

  test("GET /bff/user describes the session and is never cached", async ({
    page,
    context,
  }) => {
    await signInViaBff(page, MAIN.origin, "maintainer");
    const api = await raw(MAIN.origin, {
      [SESSION_COOKIE]: await sessionId(context),
    });
    const response = await api.get("/bff/user");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const user = (await response.json()) as Record<string, unknown>;
    expect(user).toMatchObject({
      name: "Mia Mason",
      email: "mia.mason@blub.com",
      roles: { api: ["maintainer"] },
    });
    expect(typeof user.sub).toBe("string");
    expect(Number(user.expiresAt)).toBeGreaterThan(Date.now() / 1000);
    await api.dispose();
  });

  test("the app is served with the BFF's security headers", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBeTruthy();
    expect(headers["cross-origin-opener-policy"]).toBeTruthy();
    expect(headers["access-control-allow-origin"]).toBeUndefined(); // no CORS
    expect(headers["cache-control"]).toBe("no-cache"); // index.html revalidates
  });

  test("an unknown page falls back to the SPA, an unknown API path does not", async ({
    request,
  }) => {
    const page = await request.get("/some/deep/link", {
      headers: { Accept: "text/html" },
    });
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
    const api = await request.get("/bff/nothing", {
      headers: { Accept: "text/html" },
    });
    expect(api.status()).toBe(404);
    expect(await api.json()).toEqual({ error: "not_found" });
  });
});

test.describe("without a session", () => {
  test("/bff/user and the proxy answer 401, a forged cookie too", async () => {
    const anonymous = await raw(MAIN.origin, {}, { "X-CSRF": "1" });
    expect((await anonymous.get("/bff/user")).status()).toBe(401);
    const proxied = await anonymous.get(HEROES);
    expect(proxied.status()).toBe(401);
    expect(await proxied.json()).toMatchObject({ error: "unauthorized" });

    const forged = await raw(
      MAIN.origin,
      { [SESSION_COOKIE]: "A".repeat(43) },
      { "X-CSRF": "1" },
    );
    const rejected = await forged.get("/bff/user");
    expect(rejected.status()).toBe(401);
    // A cookie the store does not know is cleared, not left in the browser.
    expect(setCookies(rejected).join("\n")).toContain(`${SESSION_COOKIE}=;`);
    await anonymous.dispose();
    await forged.dispose();
  });

  test("a login for an unknown returnTo falls back to a same-origin path", async ({
    page,
  }) => {
    // A protocol-relative URL is not a same-origin path: the login must not
    // redirect there, it lands on `/`.
    await page.goto(
      `${MAIN.origin}/bff/login?returnTo=${encodeURIComponent("//evil.example/pwn")}`,
      { waitUntil: "domcontentloaded" },
    );
    await submitKeycloakForm(page, "detective");
    await page.waitForURL(`${MAIN.origin}/**`);
    expect(new URL(page.url()).origin).toBe(MAIN.origin);
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

test.describe("CSRF and Origin", () => {
  test("a missing X-CSRF is rejected, with the session alive afterwards", async ({
    page,
    context,
  }) => {
    await signInViaBff(page, MAIN.origin, "maintainer");
    const id = await sessionId(context);
    await idle(page);
    const api = await raw(MAIN.origin, { [SESSION_COOKIE]: id });

    const logout = await api.post("/bff/logout"); // no X-CSRF
    expect(logout.status()).toBe(403);
    expect(await logout.json()).toEqual({ error: "csrf_rejected" });

    // Every /api request needs it, GET included.
    const noHeader = await api.get(HEROES);
    expect(noHeader.status()).toBe(403);
    expect(await noHeader.json()).toEqual({ error: "csrf_rejected" });
    const withHeader = await api.get(HEROES, { headers: { "X-CSRF": "1" } });
    expect(withHeader.status()).toBe(200);

    // A rejection never ends the session.
    expect((await api.get("/bff/user")).status()).toBe(200);
    expect(await storedSession(id)).not.toBeNull();
    await api.dispose();
  });

  test("a foreign Origin or Sec-Fetch-Site is rejected, the app's own Origin passes", async ({
    page,
    context,
  }) => {
    await signInViaBff(page, MAIN.origin, "maintainer");
    const id = await sessionId(context);
    await idle(page);
    const api = await raw(
      MAIN.origin,
      { [SESSION_COOKIE]: id },
      { "X-CSRF": "1" },
    );

    const foreignOrigin = await api.post("/bff/logout", {
      headers: { Origin: "https://evil.example" },
    });
    expect(foreignOrigin.status()).toBe(403);
    expect(await foreignOrigin.json()).toEqual({ error: "origin_rejected" });

    const crossSite = await api.post("/bff/logout", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(crossSite.status()).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "origin_rejected" });

    // Origin is checked before X-CSRF, and PUBLIC_ORIGIN is exact (a lookalike fails).
    const lookalike = await api.post("/bff/logout", {
      headers: { Origin: `${MAIN.origin}.evil.example` },
    });
    expect(lookalike.status()).toBe(403);

    const same = await api.post("/bff/analytics", {
      headers: { Origin: MAIN.origin, "Sec-Fetch-Site": "same-origin" },
      data: { name: "e2e.origin_ok" },
    });
    expect(same.status()).toBe(202);

    expect((await api.get("/bff/user")).status()).toBe(200);
    expect(
      logLines(MAIN.log).filter((l) => l.event === "origin_rejected").length,
    ).toBeGreaterThanOrEqual(3);
    await api.dispose();
  });

  test("the BFF sends no CORS headers, not even to a preflight", async () => {
    const api = await raw(MAIN.origin);
    const preflight = await api.fetch("/bff/logout", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-csrf",
      },
    });
    expect(preflight.headers()["access-control-allow-origin"]).toBeUndefined();
    expect(preflight.headers()["access-control-allow-headers"]).toBeUndefined();
    await api.dispose();
  });
});

test.describe("logout", () => {
  test("POST /bff/logout ends the session, clears the cookie and revokes the refresh token", async ({
    page,
    context,
    request,
  }) => {
    await signInViaBff(page, MAIN.origin, "editor");
    const id = await sessionId(context);
    await idle(page);
    const before = await storedSession(id);
    const refreshToken = before!.refreshToken!;
    const api = await raw(
      MAIN.origin,
      { [SESSION_COOKIE]: id },
      { "X-CSRF": "1" },
    );

    const response = await api.post("/bff/logout");
    expect(response.status()).toBe(200);
    const { logoutUrl } = (await response.json()) as { logoutUrl: string };
    expect(logoutUrl).toContain(`${REALM_URL}/protocol/openid-connect/logout`);

    // The cookie is cleared with the attributes it was set with.
    const cleared = setCookies(response).find((c) =>
      c.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(cleared, "a clearing Set-Cookie").toBeDefined();
    expect(cleared).toMatch(/;\s*Path=\/(;|$)/i);
    expect(cleared).toMatch(/;\s*(Expires=Thu, 01 Jan 1970|Max-Age=0)/i);

    // The session is gone from Valkey and the old cookie is useless.
    expect(await storedSession(id)).toBeNull();
    const [exists] = await valkey(["EXISTS", `sess:${id}`]);
    expect(exists).toBe(0);
    expect((await api.get("/bff/user")).status()).toBe(401);
    expect((await api.post("/bff/logout")).status()).toBe(401);

    // Best-effort RFC 7009 revocation: Keycloak refuses the old refresh token.
    const refresh = await request.post(
      `${REALM_URL}/protocol/openid-connect/token`,
      {
        form: {
          grant_type: "refresh_token",
          client_id: "bff",
          client_secret:
            process.env.E2E_BFF_CLIENT_SECRET ?? "dev-only-bff-client-secret",
          refresh_token: refreshToken,
        },
      },
    );
    expect(refresh.status()).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
    expect(
      logLines(MAIN.log).some(
        (l) => l.event === "logout" && l.security === true,
      ),
    ).toBeTruthy();
    await api.dispose();
  });

  test("Sign out in the app ends the session and the Keycloak session too", async ({
    page,
    context,
  }) => {
    await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Sign in" }).click();
    await submitKeycloakForm(page, "maintainer");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();
    const id = await sessionId(context);

    await page.getByRole("button", { name: "Sign out" }).click();
    // Keycloak's end-session endpoint returns to the app (a registered
    // post-logout URI), which shows the signed-out state.
    await page.waitForURL(`${MAIN.origin}/**`);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    expect(await sessionCookie(context)).toBeUndefined();
    expect(await storedSession(id)).toBeNull();

    // Keycloak's SSO session is gone as well: logging in asks for credentials again.
    await page.goto(`${MAIN.origin}/bff/login?returnTo=%2F`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#username")).toBeVisible();
    expect(page.url().startsWith(KEYCLOAK)).toBeTruthy();
  });

  test("a session that is already gone also reads as signed out in the SPA", async ({
    page,
    context,
  }) => {
    await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Sign in" }).click();
    await submitKeycloakForm(page, "maintainer");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    // Lose the session behind the browser's back (a Valkey flush, an expiry).
    await valkey(["DEL", `sess:${await sessionId(context)}`]);
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
