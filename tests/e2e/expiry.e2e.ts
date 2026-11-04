// Idle and absolute session timeouts, against the second BFF (config: SHORT)
// whose SESSION_IDLE_SECONDS / SESSION_ABSOLUTE_SECONDS are a few seconds, so
// the real timeouts can be waited out. The store entry is a real Valkey key
// with a real TTL, which is what ends an idle session.
import { expect, test } from "@playwright/test";
import {
  SESSION_COOKIE,
  SHORT,
  idle,
  raw,
  sessionId,
  signInViaBff,
  sleep,
  storedSession,
  valkey,
} from "./lane";

test("an idle session ends after SESSION_IDLE_SECONDS, and activity keeps it alive", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await signInViaBff(page, SHORT.origin, "maintainer");
  const id = await sessionId(context);
  await idle(page); // the SPA polls, and a poll would count as activity
  const api = await raw(SHORT.origin, { [SESSION_COOKIE]: id });

  // The key's TTL is the idle timeout (the absolute one is further away).
  const [ttl] = await valkey(["PTTL", `sess:${id}`]);
  expect(Number(ttl)).toBeGreaterThan(0);
  expect(Number(ttl)).toBeLessThanOrEqual(SHORT.idleSeconds * 1000);

  // Sliding: a request every few seconds outlives several idle periods...
  const startedAt = Date.now();
  while (Date.now() - startedAt < (SHORT.idleSeconds + 3) * 1000) {
    expect((await api.get("/bff/user")).status()).toBe(200);
    await sleep(2_000);
  }

  // ...and silence does not.
  await sleep((SHORT.idleSeconds + 2) * 1000);
  expect((await api.get("/bff/user")).status()).toBe(401);
  expect(await storedSession(id)).toBeNull();
  await api.dispose();
});

test("a session ends SESSION_ABSOLUTE_SECONDS after login, however active it is", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await signInViaBff(page, SHORT.origin, "editor");
  const id = await sessionId(context);
  await idle(page);
  const api = await raw(SHORT.origin, { [SESSION_COOKIE]: id });

  const created = await storedSession(id);
  expect(created!.absoluteExpiresAt - created!.createdAt).toBe(
    SHORT.absoluteSeconds,
  );
  const user = (await (await api.get("/bff/user")).json()) as {
    expiresAt: number;
  };
  expect(user.expiresAt).toBe(created!.absoluteExpiresAt);

  // Stay active until past the absolute end: the session still ends.
  const endsAt = created!.absoluteExpiresAt * 1000;
  while (Date.now() < endsAt + 1_000) {
    await api.get("/bff/user");
    await sleep(2_000);
  }
  const response = await api.get("/bff/user");
  expect(response.status()).toBe(401);
  expect(await storedSession(id)).toBeNull();
  await api.dispose();
});
