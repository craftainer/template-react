// One journey through the manifest-driven admin (ADR 0006), signed in as the
// dev realm's maintainer (password == username) through the BFF: sign in
// through Keycloak, create, edit with a conditional save, hit a 412 after an
// out-of-band change, archive and see the record in the trash. The browser
// only ever talks to the BFF; the out-of-band changes go to the backend
// directly with a bearer token.
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  HEROES_DIRECT,
  MAIN,
  backendToken,
  laneEnv,
  submitKeycloakForm,
} from "./lane";

const bearer = (request: APIRequestContext, username: string) =>
  backendToken(request, username);

async function signIn(page: Page, username: string) {
  await page.goto(MAIN.origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).click();
  await submitKeycloakForm(page, username);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test.setTimeout(180_000);

test("the admin creates, edits, conflicts and archives a record", async ({
  page,
  request,
}) => {
  // Known failure, two findings about @craftainer/bff 0.1.0 (reported, not
  // worked around): its fixed CSP `style-src 'self'` blocks Emotion's inline
  // styles (the app renders unstyled), and with the CSP out of the way the
  // grid's conditional save still fails with "Could not read this record's
  // version" (probably its forced `Cache-Control: no-store` on `/api/*`, which
  // crud-sdk's cache will not store, so no ETag is kept). Remove this line
  // once that is fixed; Playwright then flags the test as unexpectedly passing.
  test.fail(true, "lib-bff-ts: CSP style-src and no-store on /api/*");
  const name = `E2E ${Date.now()}`;
  await signIn(page, "maintainer");
  await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();

  // Create through the dialog form.
  await page.getByRole("button", { name: "Add record" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Powers").fill("Testing, Filing");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Find it with the quick search, then open it.
  await page
    .getByRole("searchbox")
    .or(page.getByPlaceholder(/search/i))
    .first()
    .fill(name);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();

  // Edit the name in the table: a conditional save (If-Match from the SDK's
  // ETag for the row), and it sticks.
  const inlineName = `${name} inline`;
  const inlineSaved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.status() === 200,
    { timeout: 20_000 },
  );
  await row.getByRole("gridcell").first().dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" inline");
  await page.keyboard.press("Enter");
  expect((await inlineSaved).request().headers()["if-match"]).toBeTruthy();
  await expect(
    page.getByRole("row", { name: new RegExp(inlineName) }),
  ).toBeVisible();

  // Someone else changes the record after the list loaded: the next inline
  // edit is refused and sends nothing.
  const heroes = `${laneEnv("E2E_API_URL")}${HEROES_DIRECT}`;
  const found = await request.get(
    `${heroes}?name=${encodeURIComponent(inlineName)}`,
    { headers: { Authorization: await bearer(request, "maintainer") } },
  );
  const rowId = ((await found.json()) as { id: number }[])[0]!.id;
  const elsewhere = await request.patch(`${heroes}?id=${rowId}`, {
    headers: { Authorization: await bearer(request, "maintainer") },
    data: { power_level: 7 },
  });
  expect(elsewhere.ok()).toBeTruthy();
  const patches: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches.push(r.url());
  });
  await page
    .getByRole("row", { name: new RegExp(inlineName) })
    .getByRole("gridcell")
    .first()
    .dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" again");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/changed since the list loaded/)).toBeVisible();
  expect(patches).toEqual([]);

  // Leave the editor; a click that ends an edit does not open the record.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.getByRole("row", { name: new RegExp(inlineName) }).click();
  await expect(page).toHaveURL(/[?&]id=\d+/);
  const id = new URL(page.url()).searchParams.get("id");

  // A conditional save with the ETag read with the record succeeds.
  const field = page
    .getByRole("form", { name: /edit record/i })
    .getByLabel("Name");
  await expect(field).toHaveValue(inlineName);
  await field.fill(`${name} edited`);
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.status() === 200,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).request().headers()["if-match"]).toBeTruthy();
  await expect(field).toHaveValue(`${name} edited`);

  // Change the record behind the UI's back: the next save must be refused.
  const patched = await request.patch(`${heroes}?id=${id}`, {
    headers: { Authorization: await bearer(request, "maintainer") },
    data: { power_level: 99 },
  });
  expect(patched.ok()).toBeTruthy();
  await field.fill(`${name} conflicting`);
  const refused = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.status() === 412,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await refused;
  await expect(page.getByText(/was changed since you opened it/)).toBeVisible();

  // Archive it from the record page; it then shows up in the trash.
  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page).not.toHaveURL(/[?&]id=/);
  await page.getByRole("tab", { name: "Trash" }).click();
  await expect(page.getByText(`${name} edited`)).toBeVisible();

  // Statistics are offered because the manifest says so.
  await page.getByRole("tab", { name: "Statistics" }).click();
  await expect(
    page.getByRole("tab", { name: "Statistics", selected: true }),
  ).toBeVisible();
});
