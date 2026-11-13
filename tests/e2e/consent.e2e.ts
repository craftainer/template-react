// The analytics consent prompt (src/analytics/ConsentBanner.tsx, ADR 0008)
// in a real browser against the real BFF. The lane's BFF runs the default
// `implied` mode, so the prompt must show there too, and the choice lives in
// the BFF's consent cookie (`__Host-Http-consent`), not in the page.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CONSENT_COOKIE, MAIN } from "./lane";

const prompt = (page: Page) =>
  page.getByRole("heading", { name: "Count my visits?" });
const allow = (page: Page) => page.getByRole("button", { name: "Allow" });
const decline = (page: Page) => page.getByRole("button", { name: "Decline" });
const settings = (page: Page) =>
  page.getByRole("button", { name: "Analytics settings" });

/** What the BFF holds for this browser, read the way the SPA reads it. */
const stored = (page: Page) =>
  page.evaluate(
    async () =>
      (await (
        await fetch("/bff/consent", { headers: { "X-CSRF": "1" } })
      ).json()) as { analytics: boolean },
  );

const look = (button: Locator) =>
  button.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      color: s.color,
      background: s.backgroundColor,
      border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      textTransform: s.textTransform,
      height: el.getBoundingClientRect().height,
    };
  });

test("the prompt shows in implied mode, before any choice, with Allow and Decline alike", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/bff/analytics") {
      sent.push(String(response.status()));
    }
  });
  await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });

  const config = await page.evaluate(
    async () => (await fetch("/bff/config")).json() as Promise<unknown>,
  );
  expect(config).toMatchObject({
    analytics: { enabled: true, consent: "implied" },
  });

  await expect(prompt(page)).toBeVisible();
  await expect(allow(page)).toBeVisible();
  await expect(decline(page)).toBeVisible();
  // Implied mode records before an answer; the prompt is still shown.
  await expect.poll(() => sent).toContain("202");

  // Equal weight: nothing but the label differs between the two answers.
  expect(await look(allow(page))).toEqual(await look(decline(page)));
});

test("Decline is kept by the BFF's cookie, across a reload and a second tab", async ({
  page,
  context,
}) => {
  await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
  await decline(page).click();

  await expect(prompt(page)).toBeHidden();
  await expect(settings(page)).toBeVisible();
  expect(await stored(page)).toEqual({ analytics: false });
  const cookie = (await context.cookies()).find(
    (c) => c.name === CONSENT_COOKIE,
  );
  expect(cookie?.value).toBe("0");
  expect(cookie?.httpOnly).toBe(true);

  await page.reload();
  await expect(settings(page)).toBeVisible();
  await expect(prompt(page)).toBeHidden();

  const other = await context.newPage();
  await other.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
  await expect(settings(other)).toBeVisible();
  await expect(prompt(other)).toBeHidden();
});

test("the settings button reopens the prompt, a new answer replaces the old, Close changes nothing", async ({
  page,
}) => {
  await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
  await decline(page).click();
  await expect(settings(page)).toBeVisible();

  await settings(page).click();
  await expect(prompt(page)).toBeVisible();
  await expect(page.getByText("Currently: declined.")).toBeVisible();
  await allow(page).click();
  await expect(prompt(page)).toBeHidden();
  expect(await stored(page)).toEqual({ analytics: true });

  // Reopened and closed without choosing: the stored choice stays.
  await settings(page).click();
  await expect(page.getByText("Currently: allowed.")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(prompt(page)).toBeHidden();
  await settings(page).click();
  await page.keyboard.press("Escape");
  await expect(prompt(page)).toBeHidden();
  expect(await stored(page)).toEqual({ analytics: true });

  await page.reload();
  await expect(settings(page)).toBeVisible();
  await expect(prompt(page)).toBeHidden();
});

test("a browser that sends Global Privacy Control is not asked", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
      get: () => true,
    });
  });
  const page = await context.newPage();
  await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(prompt(page)).toHaveCount(0);
  await expect(settings(page)).toHaveCount(0);
  await context.close();
});
