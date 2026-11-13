import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useCrud } from "@craftainer/crud-views";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAdminStub } from "../pages/adminStub";
import { BOUNCE_KEY } from "../auth/unauthorized";
import { runTeardown } from "../auth/teardown";
import { CrudApiProvider } from "./CrudApi";
import { useCrudApi } from "./crudApiContext";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("../auth/authContext", () => ({ useAuth: useAuthMock }));
const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));
vi.mock("../auth/bff", async (original) => ({
  ...(await original<typeof import("../auth/bff")>()),
  redirectToLogin: redirectMock,
}));

function Scope() {
  const { namespace } = useCrud();
  return <output>{namespace ? namespace.scope : "pending"}</output>;
}

async function scopeFor(user: unknown): Promise<string> {
  useAuthMock.mockReturnValue({ isAuthenticated: true, user });
  installAdminStub();
  render(
    <CrudApiProvider>
      <Scope />
    </CrudApiProvider>,
  );
  const output = await screen.findByText(/^(?!pending$).+/);
  const text = output.textContent ?? "";
  cleanup();
  return text;
}

describe("CrudApiProvider query scope", () => {
  const realFetch = window.fetch;
  afterEach(() => {
    cleanup();
    window.fetch = realFetch;
  });

  it("uses the BFF user's sub, so two users never share a scope", async () => {
    const a = await scopeFor({ sub: "u1", name: "A", roles: {} });
    const b = await scopeFor({ sub: "u2", name: "B", roles: {} });

    expect(a).toBe("u1");
    expect(b).toBe("u2");
  });

  it("builds no client without a sub: it shows an error and makes no request", async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, user: undefined });
    const stub = installAdminStub();

    render(
      <CrudApiProvider>
        <Scope />
      </CrudApiProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /did not include an identity/i,
    );
    expect(stub.calls).toEqual([]);
  });
});

describe("CrudApiProvider 401 handling", () => {
  const realFetch = window.fetch;
  const user = { sub: "u1", name: "A", roles: {} };
  const unauthorised = async () => new Response(null, { status: 401 });
  const providerWithAuth = () => {
    const login = vi.fn();
    useAuthMock.mockReturnValue({ isAuthenticated: true, user, login });
    render(
      <CrudApiProvider>
        <Scope />
      </CrudApiProvider>,
    );
    return login;
  };
  beforeEach(() => {
    window.sessionStorage.clear();
    redirectMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    window.fetch = realFetch;
  });

  it("bounces to login once, leaving a marker that survives the reload", async () => {
    window.fetch = unauthorised;

    providerWithAuth();

    await waitFor(() => expect(redirectMock).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(BOUNCE_KEY)).not.toBeNull();
    expect(screen.queryByText(/not authorised/i)).toBeNull();
  });

  it("after one bounce shows 'signed in but not authorised' instead of redirecting again", async () => {
    window.sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    window.fetch = unauthorised;

    providerWithAuth();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /signed in, but not authorised/i,
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("signs in again on request, with a fresh bounce budget", async () => {
    window.sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    window.fetch = unauthorised;
    const login = providerWithAuth();

    fireEvent.click(
      await screen.findByRole("button", { name: /sign in again/i }),
    );

    expect(login).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(BOUNCE_KEY)).toBeNull();
  });

  it("clears the marker once the API answers", async () => {
    window.sessionStorage.setItem(BOUNCE_KEY, String(Date.now() - 1000));
    installAdminStub();

    providerWithAuth();

    await screen.findByText("u1");
    expect(window.sessionStorage.getItem(BOUNCE_KEY)).toBeNull();
  });
});

describe("CrudApiProvider teardown", () => {
  const realFetch = window.fetch;
  afterEach(() => {
    cleanup();
    window.fetch = realFetch;
  });

  function Probe({
    onApi,
  }: {
    onApi: (api: ReturnType<typeof useCrudApi>) => void;
  }) {
    onApi(useCrudApi());
    return <output>ready</output>;
  }

  it("clears the SDK cache on logout and on unmount", async () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      user: { sub: "u1", name: "A", roles: {} },
    });
    installAdminStub();
    let api: ReturnType<typeof useCrudApi> | undefined;
    const { unmount } = render(
      <CrudApiProvider>
        <Probe onApi={(a) => (api = a)} />
      </CrudApiProvider>,
    );
    await screen.findByText("ready");
    const clear = vi.spyOn(api!.cache, "clear");
    const close = vi.spyOn(api!.cache, "close");

    await runTeardown();
    expect(close).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);

    unmount();
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(2));
  });
});
