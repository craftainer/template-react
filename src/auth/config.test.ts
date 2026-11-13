import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

describe("loadRuntimeConfig", () => {
  it("reads /bff/config", async () => {
    const fetchFake = async () =>
      new Response(JSON.stringify({ analyticsConsent: "implied" }));

    await expect(loadRuntimeConfig(fetchFake)).resolves.toEqual({
      analyticsConsent: "implied",
    });
  });

  it("falls back to {} on an error status, a bad body or a network failure", async () => {
    await expect(
      loadRuntimeConfig(async () => new Response(null, { status: 500 })),
    ).resolves.toEqual({});
    await expect(
      loadRuntimeConfig(async () => new Response("[1]")),
    ).resolves.toEqual({});
    await expect(
      loadRuntimeConfig(async () => {
        throw new TypeError("offline");
      }),
    ).resolves.toEqual({});
  });

  it("gives up on a request that never settles, so the page is not left blank", async () => {
    const hangs = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });

    await expect(loadRuntimeConfig(hangs, 10)).resolves.toEqual({});
  });
});
