// The SPA's 401 loop guard (src/auth/unauthorized.ts, ADR 0007) against the
// real stack. A final 401 from `/api/*` sends the browser to `/bff/login`
// once; while the Keycloak SSO session lives that bounce is silent, so a
// signed-in user the API keeps refusing would loop forever. The guard lives in
// `sessionStorage`, fails closed (a second 401 shows "signed in, but not
// authorised" and a manual button) and re-arms only when a resource request
// succeeds with a 2xx.
//
// Real: Keycloak's login and SSO, the BFF, Valkey, the proxy and the API. The
// persistent 401 cannot be produced by the lane (a user without the role gets
// a 403, never a 401), so one spec injects it in the browser for the heroes
// resource only; everything else, including the bounce, stays real.
import { expect, test, type Page } from "@playwright/test";
import {
  HEROES,
  MAIN,
  SESSION_COOKIE,
  raw,
  sessionId,
  submitKeycloakForm,
  valkey,
} from "./lane";

const BOUNCE_KEY = "bff.login-bounce";
const NOT_AUTHORISED = /signed in, but not authorised/i;
/** The resource calls only: discovery (manifest, api-catalog) is not one. */
const RESOURCE = "**/api/crud/crud/v1/heroes/**";

test.setTimeout(180_000);

async function signIn(page: Page, username: string) {
  await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).click();
  await submitKeycloakForm(page, username);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

const marker = (page: Page) =>
  page.evaluate((key) => window.sessionStorage.getItem(key), BOUNCE_KEY);

/** Counts the navigations to `/bff/login` the browser makes from now on. */
function loginRequests(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/bff/login") count += 1;
  });
  return () => count;
}

test("a session that ended is re-created by one silent bounce, and the guard re-arms on the first 2xx", async ({
  page,
  context,
}) => {
  await signIn(page, "maintainer");
  await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();
  const before = await sessionId(context);
  const bounces = loginRequests(page);

  // End the session behind the SPA's back, then make it ask for a resource.
  await valkey(["DEL", `sess:${before}`]);
  await page.getByRole("tab", { name: "Trash" }).click();

  // One bounce: the Keycloak SSO session signs the user straight back in, with
  // a new BFF session, and the list loads again.
  await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect.poll(() => sessionId(context)).not.toBe(before);
  expect(bounces()).toBe(1);
  await expect(page.getByText(NOT_AUTHORISED)).toHaveCount(0);

  // The resource 2xx after the bounce re-armed the guard.
  await expect.poll(() => marker(page)).toBeNull();
});

test("a 401 that persists after the bounce fails closed, survives a reload, and re-arms only on a resource 2xx", async ({
  page,
  context,
}) => {
  await signIn(page, "maintainer");
  await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();
  const bounces = loginRequests(page);

  // From here the API refuses every resource request with a 401.
  await context.route(RESOURCE, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not authenticated" }),
    }),
  );
  await page.reload();

  // First 401: one bounce through the BFF and Keycloak. Second: the error.
  await expect(page.getByText(NOT_AUTHORISED)).toBeVisible();
  expect(bounces()).toBe(1);
  expect(await marker(page)).not.toBeNull();
  const button = page.getByRole("button", { name: "Sign in again" });
  await expect(button).toBeVisible();

  // The marker is in sessionStorage: a reload stays blocked and does not bounce.
  await page.reload();
  await expect(page.getByText(NOT_AUTHORISED)).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(bounces()).toBe(1);

  // Discovery alone (the page loads the manifest while blocked) never re-arms.
  expect(await marker(page)).not.toBeNull();

  // The API recovers; the manual button clears the marker and signs in again,
  // and the first resource 2xx keeps it clear.
  await context.unroute(RESOURCE);
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();
  await expect(page.getByText(NOT_AUTHORISED)).toHaveCount(0);
  await expect.poll(() => marker(page)).toBeNull();
});

test("a user without the resource role gets a 403, not a login loop", async ({
  page,
  context,
}) => {
  const bounces = loginRequests(page);
  await signIn(page, "security");
  const id = await sessionId(context);

  // The backend refuses `security` on heroes; the BFF passes the 403 through.
  const api = await raw(
    MAIN.origin,
    { [SESSION_COOKIE]: id },
    { "X-CSRF": "1" },
  );
  const response = await api.get(HEROES);
  expect(response.status()).toBe(403);
  expect(await response.text()).toContain("Insufficient role");
  await api.dispose();

  // A 403 is not a lapsed session: no further bounce, no guard marker.
  await page.waitForTimeout(1_500);
  expect(bounces()).toBe(1); // the sign-in itself
  expect(await marker(page)).toBeNull();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
