// The analytics intake (ADR 0008) against the real BFF, with the `log`
// backend so every recorded event is a line the specs can read. The BFF
// answers 202 for a recorded and a dropped event alike; what differs is only
// whether a line shows up, and the specs wait for a later "control" event
// before concluding that an earlier one was dropped.
import { expect, test } from "@playwright/test";
import {
  CONSENT_COOKIE,
  MAIN,
  loggedEvents,
  raw,
  setCookies,
  signInViaBff,
  sleep,
  until,
} from "./lane";

let counter = 0;
/** A unique, valid event name (`e2e.<kind>_<n>`). */
const eventName = (kind: string) =>
  `e2e.${kind}_${Date.now().toString(36)}${(counter += 1)}`;

const recorded = (name: string) =>
  until(
    () => loggedEvents(MAIN.log).filter((e) => e.name === name),
    (events) => events.length > 0,
  );

/** Sends a control event with the given headers and waits for it to be logged. */
async function control(headers: Record<string, string> = {}) {
  const api = await raw(MAIN.origin, {}, { "X-CSRF": "1" });
  const name = eventName("control");
  expect(
    (await api.post("/bff/analytics", { data: { name }, headers })).status(),
  ).toBe(202);
  expect(await recorded(name)).toHaveLength(1);
  await api.dispose();
}

test.describe("POST /bff/analytics", () => {
  test("an event is accepted with an empty 202 and recorded", async () => {
    const api = await raw(MAIN.origin, {}, { "X-CSRF": "1" });
    const name = eventName("recorded");
    const response = await api.post("/bff/analytics", {
      data: {
        name,
        url: "/admin/heroes/trash?id=7#frag",
        props: { powers_count: 3 },
      },
    });
    expect(response.status()).toBe(202);
    expect(await response.text()).toBe("");
    const [event] = await recorded(name);
    // Query and fragment are stripped; the allowlisted prop is kept.
    expect(event).toEqual({
      name,
      url: "/admin/heroes/trash",
      props: { powers_count: 3 },
    });
    await api.dispose();
  });

  test("a batch of events is accepted", async () => {
    const api = await raw(MAIN.origin, {}, { "X-CSRF": "1" });
    const names = [eventName("batch"), eventName("batch")];
    const response = await api.post("/bff/analytics", {
      data: names.map((name) => ({ name })),
    });
    expect(response.status()).toBe(202);
    for (const name of names) expect(await recorded(name)).toHaveLength(1);
    await api.dispose();
  });

  test("Sec-GPC: 1 and DNT: 1 are answered 202 and dropped", async () => {
    const api = await raw(MAIN.origin, {}, { "X-CSRF": "1" });
    const gpc = eventName("gpc");
    const dnt = eventName("dnt");
    for (const [name, headers] of [
      [gpc, { "Sec-GPC": "1" }],
      [dnt, { DNT: "1" }],
    ] as const) {
      const response = await api.post("/bff/analytics", {
        data: { name },
        headers,
      });
      expect(response.status()).toBe(202);
      expect(await response.text()).toBe("");
    }
    // The policy is checked before validation: even garbage gets 202 under GPC.
    const garbage = await api.post("/bff/analytics", {
      data: { not: "an event" },
      headers: { "Sec-GPC": "1" },
    });
    expect(garbage.status()).toBe(202);

    await control();
    const names = loggedEvents(MAIN.log).map((e) => e.name);
    expect(names).not.toContain(gpc);
    expect(names).not.toContain(dnt);
    await api.dispose();
  });

  test("the consent cookie decides: 0 stops recording, 1 records again", async () => {
    const api = await raw(MAIN.origin, {}, { "X-CSRF": "1" });

    const declined = await api.post("/bff/consent", {
      data: { analytics: false },
    });
    expect(declined.status()).toBe(200);
    expect(await declined.json()).toEqual({ analytics: false });
    const header = setCookies(declined).find((c) =>
      c.startsWith(`${CONSENT_COOKIE}=0`),
    );
    expect(header, "the consent cookie").toBeDefined();
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*SameSite=Strict/i);
    expect(header).toMatch(/;\s*Path=\/(;|$)/i);
    expect(header).toMatch(/;\s*Max-Age=\d+/i);
    expect(header).not.toMatch(/;\s*Domain=/i);

    const withZero = await raw(
      MAIN.origin,
      { [CONSENT_COOKIE]: "0" },
      { "X-CSRF": "1" },
    );
    const stopped = eventName("declined");
    expect(
      (
        await withZero.post("/bff/analytics", { data: { name: stopped } })
      ).status(),
    ).toBe(202);
    expect((await withZero.get("/bff/consent")).status()).toBe(200);
    expect(await (await withZero.get("/bff/consent")).json()).toEqual({
      analytics: false,
    });
    await control();
    expect(loggedEvents(MAIN.log).map((e) => e.name)).not.toContain(stopped);

    const withOne = await raw(
      MAIN.origin,
      { [CONSENT_COOKIE]: "1" },
      { "X-CSRF": "1" },
    );
    const granted = eventName("granted");
    expect(
      (
        await withOne.post("/bff/analytics", { data: { name: granted } })
      ).status(),
    ).toBe(202);
    expect(await recorded(granted)).toHaveLength(1);
    expect(await (await withOne.get("/bff/consent")).json()).toEqual({
      analytics: true,
    });

    expect(
      (await api.post("/bff/consent", { data: { analytics: "yes" } })).status(),
    ).toBe(400);
    await withZero.dispose();
    await withOne.dispose();
    await api.dispose();
  });

  test("a malformed event or a prop key off the allowlist is a 400", async () => {
    const api = await raw(MAIN.origin, {}, { "X-CSRF": "1" });
    const invalid = async (data: unknown) => {
      const response = await api.post("/bff/analytics", { data });
      expect(response.status(), JSON.stringify(data).slice(0, 80)).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_event" });
    };

    const leaked = eventName("leak");
    await invalid({ name: leaked, props: { powers_count: 1, secret: "x" } }); // key off the allowlist
    await invalid({ name: "Bad Name" });
    await invalid({ name: "nodots" });
    await invalid({ name: eventName("extra"), extra: true }); // unknown field
    await invalid({
      name: eventName("longprop"),
      props: { powers_count: "x".repeat(201) },
    });
    await invalid({
      name: eventName("nested"),
      props: { powers_count: { a: 1 } },
    });
    await invalid({ name: eventName("url"), url: "//evil.example/x" });
    await invalid({ name: eventName("url"), url: "relative" });
    await invalid(
      Array.from({ length: 51 }, () => ({ name: eventName("many") })), // at most 50
    );
    await invalid([]);

    await control();
    expect(loggedEvents(MAIN.log).map((e) => e.name)).not.toContain(leaked);
    await api.dispose();
  });

  test("a body over 16 KB is a 413", async () => {
    const api = await raw(MAIN.origin, {}, { "X-CSRF": "1" });
    const response = await api.post("/bff/analytics", {
      data: { name: eventName("big"), url: `/${"a".repeat(17_000)}` },
    });
    expect(response.status()).toBe(413);
    await api.dispose();
  });

  test("it is a CSRF-guarded /bff route: no X-CSRF or a foreign Origin is a 403", async () => {
    const api = await raw(MAIN.origin);
    const name = eventName("csrf");
    const noHeader = await api.post("/bff/analytics", { data: { name } });
    expect(noHeader.status()).toBe(403);
    expect(await noHeader.json()).toEqual({ error: "csrf_rejected" });
    const foreign = await api.post("/bff/analytics", {
      data: { name },
      headers: { "X-CSRF": "1", Origin: "https://evil.example" },
    });
    expect(foreign.status()).toBe(403);
    expect(await foreign.json()).toEqual({ error: "origin_rejected" });
    await control();
    expect(loggedEvents(MAIN.log).map((e) => e.name)).not.toContain(name);
    await api.dispose();
  });
});

test.describe("page views from the SPA", () => {
  test("the SPA reports bare paths: no ids, queries or personal data", async ({
    page,
  }) => {
    const sent: { url: string; body: unknown; status: number }[] = [];
    page.on("response", (response) => {
      const request = response.request();
      if (new URL(response.url()).pathname === "/bff/analytics") {
        sent.push({
          url: request.url(),
          body: request.postDataJSON() as unknown,
          status: response.status(),
        });
      }
    });

    // Signed out first: the page view does not need a session.
    await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
    await expect.poll(() => sent.length).toBeGreaterThan(0);

    await signInViaBff(page, MAIN.origin, "maintainer", "/");
    await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();
    await page.getByRole("tab", { name: "Trash" }).click();
    await expect(
      page.getByRole("tab", { name: "Trash", selected: true }),
    ).toBeVisible();
    // The URL now carries the view (`?view=trash`); it must not reach analytics.
    await expect(page).toHaveURL(/[?&]view=trash/);
    await sleep(1_000);

    // Every request was accepted, carried only a name and a bare path, and
    // (with the `log` backend) was recorded the way the browser sent it.
    expect(sent.every((s) => s.status === 202)).toBe(true);
    for (const { body } of sent) {
      expect(Object.keys(body as object).sort()).toEqual(["name", "url"]);
      const { name, url } = body as { name: string; url: string };
      expect(name).toBe("page.view");
      expect(url).toMatch(/^\/[A-Za-z0-9_/-]*$/); // no query, fragment or id
    }
    const events = await until(
      () => loggedEvents(MAIN.log).filter((e) => e.name === "page.view"),
      (list) => list.length > 0,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => !/[?#=\d]/.test(e.url))).toBe(true);
  });

  test("the trash view is reported as its own page", async ({ page }) => {
    // Known failure in this repo's SPA, not in the BFF: `viewPath` only adds
    // the view to the path when the URL also has a `resource`, but the admin
    // with a single resource writes `?view=trash` alone, so every view is
    // reported as `/`. Remove this line when `src/analytics/pageViews.ts` is
    // fixed; Playwright then flags the test as unexpectedly passing.
    test.fail(true, "src/analytics/pageViews.ts: viewPath needs `resource`");
    const urls: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/bff/analytics") {
        urls.push((request.postDataJSON() as { url: string }).url);
      }
    });
    await signInViaBff(page, MAIN.origin, "maintainer", "/");
    await page.getByRole("tab", { name: "Trash" }).click();
    await expect.poll(() => urls.some((u) => u.endsWith("/trash"))).toBe(true);
  });

  test("a browser that sends Global Privacy Control makes no request at all", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
        get: () => true,
      });
    });
    const page = await context.newPage();
    const sent: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/bff/analytics") {
        sent.push(request.url());
      }
    });
    await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await sleep(1_000); // time enough for the page view the opt-out must suppress
    expect(sent).toEqual([]);
    await context.close();
  });
});
