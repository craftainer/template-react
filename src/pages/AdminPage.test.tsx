import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memoryUrlAdapter } from "@craftainer/crud-views";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";
import { installAdminStub } from "./adminStub";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("react-oidc-context", () => ({ useAuth: useAuthMock }));

describe("AdminPage", () => {
  const realFetch = window.fetch;

  beforeEach(() => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      user: { access_token: "tok", profile: { sub: "u1" } },
    });
  });
  afterEach(() => {
    cleanup();
    window.fetch = realFetch;
  });

  it("lists the manifest's resource with its tabs only where capabilities allow", async () => {
    installAdminStub();

    render(<AdminPage urlAdapter={memoryUrlAdapter()} />);

    expect(
      await screen.findByRole("heading", { name: "Heroes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Statistics" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Predictions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trash" })).toBeInTheDocument();
  });

  it("says so when the caller can see no resource", async () => {
    installAdminStub({ manifest: "none" });

    render(<AdminPage urlAdapter={memoryUrlAdapter()} />);

    expect(
      await screen.findByText(/can see no resources/i),
    ).toBeInTheDocument();
  });

  it("shows an error when the manifest is refused", async () => {
    installAdminStub({ manifest: "denied" });

    render(<AdminPage urlAdapter={memoryUrlAdapter()} />);

    expect(await screen.findByText(/could not load the api/i)).toBeVisible();
  });

  it("opens the create form from Add record", async () => {
    installAdminStub();
    render(<AdminPage urlAdapter={memoryUrlAdapter()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Add record" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("saves an edit with the ETag the SDK cached when the record was read", async () => {
    const stub = installAdminStub();
    render(<AdminPage urlAdapter={memoryUrlAdapter("id=1")} />);

    const name = await screen.findByDisplayValue("Captain Ledger");
    await userEvent.clear(name);
    await userEvent.type(name, "Captain Ledger II");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(stub.ifMatch).toEqual(['"1-0"']));
  });

  it("refuses a stale If-Match like the backend (the stub the stories rely on)", async () => {
    const stub = installAdminStub();
    const patch = (ifMatch: string) =>
      window.fetch(
        `${window.location.origin}/api/crud/v1/heroes/v2/json?id=1`,
        {
          method: "PATCH",
          headers: { "If-Match": ifMatch, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "X" }),
        },
      );

    expect((await patch('"1-0"')).status).toBe(200);
    expect((await patch('"1-0"')).status).toBe(412);
    expect(stub.ifMatch).toEqual(['"1-0"', '"1-0"']);
  });
});
