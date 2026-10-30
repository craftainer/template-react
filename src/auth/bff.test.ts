import { describe, expect, it, vi } from "vitest";
import {
  fetchUser,
  loginUrl,
  logout,
  redirectToLogin,
  safeReturnTo,
} from "./bff";

const ORIGIN = "https://app.test";

describe("safeReturnTo", () => {
  it("keeps a same-origin path with its query and fragment", () => {
    expect(safeReturnTo("/admin?resource=heroes#top", ORIGIN)).toBe(
      "/admin?resource=heroes#top",
    );
  });

  it.each([
    "https://evil.test/x",
    "//evil.test/x",
    "/\\evil.test",
    "javascript:alert(1)",
    "admin",
    "",
  ])("falls back to / for %j", (value) => {
    expect(safeReturnTo(value, ORIGIN)).toBe("/");
  });

  it("falls back to / for nothing", () => {
    expect(safeReturnTo(null, ORIGIN)).toBe("/");
    expect(safeReturnTo(undefined, ORIGIN)).toBe("/");
  });
});

describe("login", () => {
  it("builds /bff/login with an encoded same-origin returnTo", () => {
    expect(loginUrl("/a?b=c")).toBe("/bff/login?returnTo=%2Fa%3Fb%3Dc");
    expect(loginUrl("https://evil.test")).toBe("/bff/login?returnTo=%2F");
  });

  it("navigates to it as a top-level navigation", () => {
    const navigate = vi.fn();
    redirectToLogin("/x", navigate);
    expect(navigate).toHaveBeenCalledWith("/bff/login?returnTo=%2Fx");
  });
});

describe("fetchUser", () => {
  const user = { sub: "u1", name: "Ada", roles: {}, expiresAt: 1 };

  it("returns the user on 200 and sends the cookie but no X-CSRF (a GET)", async () => {
    const fetchFake = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(user)),
    );

    await expect(fetchUser(fetchFake)).resolves.toEqual(user);
    const [url, init] = fetchFake.mock.calls[0];
    expect(url).toBe("/bff/user");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).has("X-CSRF")).toBe(false);
  });

  it("returns null on 401 and throws on any other failure", async () => {
    await expect(
      fetchUser(async () => new Response(null, { status: 401 })),
    ).resolves.toBeNull();
    await expect(
      fetchUser(async () => new Response(null, { status: 502 })),
    ).rejects.toThrow(/502/);
  });
});

describe("logout", () => {
  it("POSTs with X-CSRF, then navigates to the returned logoutUrl", async () => {
    const fetchFake = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ logoutUrl: "https://idp.test/logout?x=1" }),
        ),
    );
    const navigate = vi.fn();

    await logout(fetchFake, navigate);

    const [url, init] = fetchFake.mock.calls[0];
    expect(url).toBe("/bff/logout");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-CSRF")).toBe("1");
    expect(navigate).toHaveBeenCalledWith("https://idp.test/logout?x=1");
  });

  it("refuses a missing or non-http(s) logoutUrl and a failed request", async () => {
    const navigate = vi.fn();
    for (const body of [{}, { logoutUrl: "javascript:alert(1)" }]) {
      await expect(
        logout(async () => new Response(JSON.stringify(body)), navigate),
      ).rejects.toThrow(/logoutUrl/);
    }
    await expect(
      logout(async () => new Response(null, { status: 403 }), navigate),
    ).rejects.toThrow(/403/);
    expect(navigate).not.toHaveBeenCalled();
  });
});
