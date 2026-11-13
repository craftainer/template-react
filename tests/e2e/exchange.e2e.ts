// Token exchange (RFC 8693) on the `crud` upstream: the backend is called with
// a token the BFF exchanged for the `api` audience, not the session's own, and
// when Keycloak refuses the exchange the BFF fails closed (502) instead of
// forwarding the session token. Claim names and values are printed, never tokens.
import { expect, test } from "@playwright/test";
import {
  HEROES,
  MAIN,
  REALM_URL,
  SESSION_COOKIE,
  keycloakAdmin,
  logLines,
  raw,
  sessionId,
  signInViaBff,
  storedSession,
  until,
} from "./lane";

interface Claims {
  aud?: string | string[];
  azp?: string;
  iss?: string;
  realm_access?: unknown;
  resource_access?: unknown;
  scope?: string;
  jti?: string;
}

function claims(jwt: string): Claims {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"),
  ) as Claims;
}
const audiences = (c: Claims) => [c.aud ?? []].flat();
const summary = (c: Claims) =>
  JSON.stringify({
    aud: c.aud,
    azp: c.azp,
    iss: c.iss,
    scope: c.scope,
    realm_access: c.realm_access,
    resource_access: c.resource_access,
  });

test("the backend receives an access token exchanged for the api audience", async ({
  page,
  context,
}) => {
  await signInViaBff(page, MAIN.origin, "maintainer");
  const id = await sessionId(context);

  const session = await raw(
    MAIN.origin,
    { [SESSION_COOKIE]: id },
    { "X-CSRF": "1" },
  );
  const response = await session.get(HEROES);
  expect(
    response.status(),
    `a proxied CRUD call: ${await response.text()}`,
  ).toBe(200);
  await session.dispose();

  // The BFF caches the exchanged token in the session, per audience.
  const stored = (await storedSession(id)) as unknown as {
    accessToken: string;
    exchanged?: Record<string, { accessToken: string; expiresAt: number }>;
  };
  const exchanged = stored.exchanged?.api?.accessToken;
  expect(exchanged, "an exchanged token cached for `api`").toBeDefined();
  const sessionClaims = claims(stored.accessToken);
  const exchangedClaims = claims(exchanged!);
  console.log("session token  :", summary(sessionClaims));
  console.log("exchanged token:", summary(exchangedClaims));

  expect(exchanged).not.toBe(stored.accessToken);
  expect(exchangedClaims.jti).toBeDefined();
  expect(exchangedClaims.jti).not.toBe(sessionClaims.jti);
  expect(audiences(exchangedClaims)).toContain("api");
  expect(exchangedClaims.azp).toBe("bff");
  expect(exchangedClaims.iss).toBe(REALM_URL);
});

test("fails closed with 502 token_exchange_failed when Keycloak refuses the exchange", async ({
  page,
  context,
}) => {
  const admin = await keycloakAdmin();
  const setExchange = async (value: string) => {
    const client = await admin.client("bff");
    await admin.updateClient({
      ...client,
      attributes: {
        ...((client.attributes ?? {}) as Record<string, string>),
        "standard.token.exchange.enabled": value,
      },
    });
  };
  await setExchange("false");
  try {
    // A new session: the first test's exchanged token is cached per session.
    await signInViaBff(page, MAIN.origin, "editor");
    const id = await sessionId(context);
    const session = await raw(
      MAIN.origin,
      { [SESSION_COOKIE]: id },
      { "X-CSRF": "1" },
    );
    const response = await session.get(HEROES);
    expect(response.status()).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "token_exchange_failed",
    });
    await session.dispose();

    const events = await until(
      () =>
        logLines(MAIN.log).filter((l) => l.event === "token_exchange_failed"),
      (found) => found.length > 0,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ audience: "api" });
    expect(JSON.stringify(events)).not.toContain("eyJ");
  } finally {
    await setExchange("true");
    await admin.dispose();
  }
});
