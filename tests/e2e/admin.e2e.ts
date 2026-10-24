// One journey through the manifest-driven admin, signed in as the dev realm's
// maintainer (password == username) against a real template-fastapi: sign in
// through Keycloak, create, edit with a conditional save, hit a 412 after an
// out-of-band change, archive and see the record in the trash.
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const authority =
  process.env.E2E_OIDC_AUTHORITY ??
  "http://keycloak:8080/realms/template-fastapi";
const HEROES = "/api/crud/v1/heroes/v2/json";

async function signIn(page: Page, username: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(username);
  await page.locator("#kc-login").click();
  await expect(page.getByText(username, { exact: true })).toBeVisible();
}

async function bearer(request: APIRequestContext, username: string) {
  const response = await request.post(
    `${authority}/protocol/openid-connect/token`,
    {
      form: {
        grant_type: "password",
        client_id: "api",
        username,
        password: username,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return `Bearer ${(await response.json()).access_token as string}`;
}

test.setTimeout(180_000);

test("the admin creates, edits, conflicts and archives a record", async ({
  page,
  request,
}) => {
  const name = `E2E ${Date.now()}`;
  await signIn(page, "maintainer");
  await expect(page.getByRole("heading", { name: "Heroes" })).toBeVisible();

  // Create through the dialog form.
  await page.getByRole("button", { name: "Add record" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Powers").fill("Testing, Filing");
  await dialog.getByRole("button", { name: /save|create/i }).click();
  await expect(dialog).toBeHidden();

  // Find it with the quick search, then open it.
  await page
    .getByRole("searchbox")
    .or(page.getByPlaceholder(/search/i))
    .first()
    .fill(name);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/[?&]id=\d+/);
  const id = new URL(page.url()).searchParams.get("id");

  // A conditional save with the ETag read with the record succeeds.
  const field = page.getByLabel("Name");
  await expect(field).toHaveValue(name);
  await field.fill(`${name} edited`);
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.status() === 200,
  );
  await page.getByRole("button", { name: /save/i }).click();
  expect((await saved).request().headers()["if-match"]).toBeTruthy();
  await expect(field).toHaveValue(`${name} edited`);

  // Change the record behind the UI's back: the next save must be refused.
  const patched = await request.patch(`${HEROES}?id=${id}`, {
    headers: { Authorization: await bearer(request, "maintainer") },
    data: { power_level: 99 },
  });
  expect(patched.ok()).toBeTruthy();
  await field.fill(`${name} conflicting`);
  const refused = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.status() === 412,
  );
  await page.getByRole("button", { name: /save/i }).click();
  await refused;
  await expect(page.getByText("Saved")).toBeHidden();

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
