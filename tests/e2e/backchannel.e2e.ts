// OIDC Back-Channel Logout 1.0 against the real Keycloak: an admin ends a
// user's sessions at the IdP, Keycloak POSTs a signed logout token to the BFF
// (the URL global-setup.ts configured), and the BFF ends its own sessions.
// This also settles the logout token's `typ` header and `sid` claim, which the
// BFF's unit tests could only assume.
import { expect, test } from "@playwright/test";
import {
  MAIN,
  SESSION_COOKIE,
  idle,
  keycloakAdmin,
  logLines,
  raw,
  sessionId,
  signInViaBff,
  storedSession,
  valkey,
} from "./lane";

test("an admin logout at Keycloak ends the BFF session", async ({
  browser,
}) => {
  // Two browsers, one user: each has its own Keycloak session and its own `sid`.
  const first = await browser.newContext();
  const second = await browser.newContext();
  const pageA = await first.newPage();
  const pageB = await second.newPage();
  await signInViaBff(pageA, MAIN.origin, "viewer");
  await signInViaBff(pageB, MAIN.origin, "viewer");
  const idA = await sessionId(first);
  const idB = await sessionId(second);
  await idle(pageA);
  await idle(pageB);

  const live = await storedSession(idA);
  expect(live?.sid, "the ID token carries a sid").toBeTruthy();
  expect((await storedSession(idB))?.sid).not.toBe(live?.sid);
  const [members] = await valkey(["SCARD", `sid:${live!.sid}`]);
  expect(members).toBe(1); // the index back-channel logout resolves by

  const before = logLines(MAIN.log).filter(
    (l) => l.event === "backchannel_logout",
  ).length;

  const admin = await keycloakAdmin();
  await admin.logoutUser("viewer");
  await admin.dispose();

  // Keycloak delivers the tokens asynchronously.
  await expect
    .poll(
      async () =>
        (await storedSession(idA)) === null &&
        (await storedSession(idB)) === null,
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(await storedSession(idA)).toBeNull();
  expect(await storedSession(idB)).toBeNull();

  for (const id of [idA, idB]) {
    const api = await raw(MAIN.origin, { [SESSION_COOKIE]: id });
    expect((await api.get("/bff/user")).status()).toBe(401);
    await api.dispose();
  }
  const events = logLines(MAIN.log).filter(
    (l) => l.event === "backchannel_logout",
  );
  expect(events.length - before).toBe(2);
  expect(events.slice(before).every((e) => e.sessions === 1)).toBeTruthy();

  await first.close();
  await second.close();
});

test("the endpoint is exempt from X-CSRF but refuses anything unsigned", async () => {
  const api = await raw(MAIN.origin);
  // No X-CSRF and no Origin: the exemption means 400 (bad token), not 403.
  const missing = await api.post("/bff/backchannel-logout", { form: {} });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "invalid_request" });

  const garbage = await api.post("/bff/backchannel-logout", {
    form: { logout_token: "not.a.jwt" },
  });
  expect(garbage.status()).toBe(400);

  // A well-formed but unsigned token is not accepted either.
  const header = Buffer.from('{"alg":"none","typ":"logout+jwt"}').toString(
    "base64url",
  );
  const claims = Buffer.from(
    JSON.stringify({
      iss: "http://localhost:8080/realms/template-fastapi",
      aud: "bff",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: "e2e-unsigned",
      sid: "does-not-matter",
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    }),
  ).toString("base64url");
  const unsigned = await api.post("/bff/backchannel-logout", {
    form: { logout_token: `${header}.${claims}.` },
  });
  expect(unsigned.status()).toBe(400);
  expect(
    logLines(MAIN.log).filter((l) => l.event === "backchannel_logout_rejected")
      .length,
  ).toBeGreaterThanOrEqual(3);
  await api.dispose();
});
