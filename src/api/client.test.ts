import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "./client";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefixes the path with /api/crud and sends the cookie and X-CSRF, no token", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/health/live");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/crud/health/live");
    expect(init?.credentials).toBe("include");
    const headers = init!.headers as Headers;
    expect(headers.get("X-CSRF")).toBe("1");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("navigates to login on a 401 unless told not to", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(apiFetch("/x")).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toMatch(/^\/bff\/login\?returnTo=%2F/);

    assign.mockClear();
    await expect(
      apiFetch("/x", { redirectOnUnauthorized: false }),
    ).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();
  });

  it("throws ApiError with the parsed problem-details body on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "not found" }), {
            status: 404,
          }),
      ),
    );

    await expect(
      apiFetch("/crud/v1/heroes/v2/json?id=1"),
    ).rejects.toMatchObject({
      status: 404,
      detail: { detail: "not found" },
    } satisfies Partial<ApiError>);
  });

  it("returns undefined for a 204 No Content response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(
      apiFetch("/crud/v1/heroes/v2/json?id=1", { init: { method: "DELETE" } }),
    ).resolves.toBeUndefined();
  });
});
