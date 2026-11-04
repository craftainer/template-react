import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memoryUrlAdapter } from "@craftainer/crud-views";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDefaultResource } from "../analytics/defaultResource";
import { PAGE_VIEW_EVENT, usePageViews } from "../analytics/pageViews";
import { AdminPage } from "./AdminPage";
import { installAdminStub } from "./adminStub";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("../auth/authContext", () => ({ useAuth: useAuthMock }));

describe("AdminPage", () => {
  const realFetch = window.fetch;

  beforeEach(() => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      user: { sub: "u1", name: "Ada", roles: { api: ["maintainer"] } },
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

  it("publishes its default resource once: no render loop, no duplicate page view", async () => {
    installAdminStub();
    const adapter = memoryUrlAdapter("view=trash");
    const send = vi.fn();
    const published: (string | undefined)[] = [];
    function Probe() {
      usePageViews(adapter, () => "/", send);
      published.push(useDefaultResource());
      return null;
    }

    render(
      <>
        <Probe />
        <AdminPage urlAdapter={adapter} />
      </>,
    );
    await screen.findByRole("heading", { name: "Heroes" });
    await new Promise((resolve) => setTimeout(resolve, 200)); // time to loop

    // The store changed twice at most (unset, then "heroes"); every other
    // render of the probe saw the same value.
    const changes = published.filter(
      (v, i) => i === 0 || v !== published[i - 1],
    );
    expect(changes).toEqual([undefined, "heroes"]);
    expect(published.length).toBeLessThan(10);
    expect(send.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      [PAGE_VIEW_EVENT, "/"],
      [PAGE_VIEW_EVENT, "/heroes/trash"],
    ]);
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

  it("offers Add record only to a caller whose roles may write", async () => {
    const signedInAs = (roles: string[]) =>
      useAuthMock.mockReturnValue({
        isAuthenticated: true,
        user: { sub: "u1", name: "Ada", roles: { api: roles } },
      });

    installAdminStub();
    signedInAs(["viewer"]);
    const viewer = render(<AdminPage urlAdapter={memoryUrlAdapter()} />);
    await screen.findByRole("heading", { name: "Heroes" });
    expect(
      screen.queryByRole("button", { name: "Add record" }),
    ).not.toBeInTheDocument();
    viewer.unmount();

    installAdminStub();
    signedInAs(["maintainer"]);
    render(<AdminPage urlAdapter={memoryUrlAdapter()} />);
    expect(
      await screen.findByRole("button", { name: "Add record" }),
    ).toBeInTheDocument();
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
        `${window.location.origin}/api/crud/crud/v1/heroes/v2/json?id=1`,
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
