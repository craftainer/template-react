import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./authContext";
import { registerTeardown } from "./teardown";
import { BOUNCE_KEY } from "./unauthorized";

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }));
vi.mock("./bff", async (original) => ({
  ...(await original<typeof import("./bff")>()),
  logout: logoutMock,
}));

const user = { sub: "u1", name: "Ada", roles: {}, expiresAt: 1 };

function Probe() {
  const auth = useAuth();
  return (
    <>
      <output>
        {auth.isLoading ? "loading" : (auth.user?.name ?? "anon")}
      </output>
      <button onClick={() => void auth.logout().catch(() => undefined)}>
        out
      </button>
    </>
  );
}

describe("AuthProvider logout", () => {
  const realFetch = window.fetch;
  beforeEach(() => {
    window.sessionStorage.clear();
    window.fetch = async () =>
      new Response(JSON.stringify(user), {
        headers: { "Content-Type": "application/json" },
      });
  });
  afterEach(() => {
    cleanup();
    window.fetch = realFetch;
    logoutMock.mockReset();
  });

  it("clears the caches and the bounce marker after the BFF ended the session", async () => {
    const teardown = vi.fn();
    const off = registerTeardown(teardown);
    window.sessionStorage.setItem(BOUNCE_KEY, "1");
    logoutMock.mockImplementation(
      async (_f: unknown, _n: unknown, after: () => Promise<void>) => after(),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("Ada");

    screen.getByRole("button", { name: "out" }).click();

    await waitFor(() => expect(teardown).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(BOUNCE_KEY)).toBeNull();
    off();
  });

  it("keeps the caches when the logout request fails", async () => {
    const teardown = vi.fn();
    const off = registerTeardown(teardown);
    logoutMock.mockRejectedValue(
      new Error("POST /bff/logout failed with status 500"),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("Ada");

    screen.getByRole("button", { name: "out" }).click();

    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
    expect(teardown).not.toHaveBeenCalled();
    off();
  });
});
