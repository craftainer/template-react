import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "./client";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefixes the path with /api and attaches a bearer token", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/health/live", {
      accessToken: "tok",
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/health/live");
    expect(init).toBeDefined();
    const headers = init!.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok");
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
