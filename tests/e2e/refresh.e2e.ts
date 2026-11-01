// Token refresh against the real Keycloak and the real Valkey. Global setup
// gives access tokens ACCESS_TOKEN_SECONDS of life and the BFF refreshes when
// 30 s are left, so a login is stale after ACCESS_TOKEN_SECONDS - 30 s. What
// this settles that the unit tests (an in-memory store) cannot: the Lua
// compare-and-set (`sess:<id>` version 0 -> 1), the refresh lock, and
// Keycloak's refresh-token rotation (revokeRefreshToken, refreshTokenMaxReuse 0).
import { expect, test } from "@playwright/test";
import {
  ACCESS_TOKEN_SECONDS,
  HEROES,
  MAIN,
  REFRESH_SKEW_SECONDS,
  SESSION_COOKIE,
  idle,
  logLines,
  raw,
  sessionId,
  signInViaBff,
  sleep,
  storedSession,
  valkey,
} from "./lane";

test("an expiring access token is refreshed once, however many requests race", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await signInViaBff(page, MAIN.origin, "maintainer");
  const id = await sessionId(context);
  await idle(page);
  const api = await raw(
    MAIN.origin,
    { [SESSION_COOKIE]: id },
    { "X-CSRF": "1" },
  );

  // Fresh: a proxied call does not touch the tokens.
  const first = await storedSession(id);
  expect(first).toMatchObject({ version: 0 });
  const lifetime = first!.accessExpiresAt - Math.floor(Date.now() / 1000);
  expect(lifetime).toBeLessThanOrEqual(ACCESS_TOKEN_SECONDS);
  expect(lifetime).toBeGreaterThan(REFRESH_SKEW_SECONDS - 5); // the realm change took effect
  expect((await api.get(HEROES)).status()).toBe(200);
  expect(await storedSession(id)).toMatchObject({
    version: 0,
    accessToken: first!.accessToken,
  });

  // Wait until the token is within the skew, then race several requests.
  const wait =
    (first!.accessExpiresAt - REFRESH_SKEW_SECONDS) * 1000 - Date.now();
  await sleep(Math.max(0, wait) + 1_500);
  const statuses = await Promise.all(
    Array.from({ length: 8 }, async () => (await api.get(HEROES)).status()),
  );
  expect(statuses).toEqual(Array(8).fill(200));

  // One refresh won the lock and the compare-and-set: version 0 -> 1, new
  // tokens, a rotated refresh token, and the lock released.
  const refreshed = await storedSession(id);
  expect(refreshed).toMatchObject({
    version: 1,
    sub: first!.sub,
    sid: first!.sid,
  });
  expect(refreshed!.accessToken).not.toBe(first!.accessToken);
  expect(refreshed!.refreshToken).not.toBe(first!.refreshToken);
  expect(refreshed!.accessExpiresAt).toBeGreaterThan(first!.accessExpiresAt);
  const [lock] = await valkey(["EXISTS", `lock:${id}`]);
  expect(lock).toBe(0);

  // The session kept its identity and its end: a refresh never extends it.
  expect(refreshed!.absoluteExpiresAt).toBeLessThanOrEqual(
    first!.absoluteExpiresAt,
  );
  expect(refreshed!.createdAt).toBe(first!.createdAt);
  expect((await api.get("/bff/user")).status()).toBe(200);
  expect(logLines(MAIN.log).some((l) => l.event === "refresh_failed")).toBe(
    false,
  );
  await api.dispose();
});

test("a refresh Keycloak rejects ends the session", async ({
  page,
  context,
}) => {
  await signInViaBff(page, MAIN.origin, "editor");
  const id = await sessionId(context);
  await idle(page);
  const api = await raw(
    MAIN.origin,
    { [SESSION_COOKIE]: id },
    { "X-CSRF": "1" },
  );
  expect((await api.get(HEROES)).status()).toBe(200);

  // Make the stored token stale and its refresh token one Keycloak never
  // issued (an `invalid_grant`), keeping the key's TTL.
  const stored = await storedSession(id);
  const broken = {
    ...stored,
    refreshToken: "not-a-refresh-token",
    accessExpiresAt: 0,
  };
  const [ok] = await valkey([
    "SET",
    `sess:${id}`,
    JSON.stringify(broken),
    "KEEPTTL",
  ]);
  expect(ok).toBe("OK");

  const rejected = await api.get(HEROES);
  expect(rejected.status()).toBe(401);
  expect(await rejected.json()).toEqual({ error: "session_expired" });
  expect(await storedSession(id)).toBeNull();
  expect((await api.get("/bff/user")).status()).toBe(401);
  expect(logLines(MAIN.log).some((l) => l.event === "refresh_failed")).toBe(
    true,
  );
  await api.dispose();
});
