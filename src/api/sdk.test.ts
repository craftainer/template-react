import { describe, expect, it, vi } from "vitest";
import { manifestFixture, recordFixtures } from "../pages/adminFixtures";
import { createCrudApi, latestResources, withApiPrefix } from "./sdk";

const ORIGIN = "https://app.test";

/** The ETag the SDK cache holds for a record, as CrudProvider's `etags` reads it. */
function etagGetter(
  api: Awaited<ReturnType<typeof createCrudApi>>,
  resource: { readonly name: string; readonly api_version: string },
) {
  return async (id: number) =>
    api.cache.cachedEtag(
      resource.name,
      id,
      await api.client.scope(),
      resource.api_version,
    );
}

describe("withApiPrefix", () => {
  it("moves a Request under /api/crud and keeps its method, headers and body", async () => {
    const base = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    const prefixed = withApiPrefix(base, ORIGIN);

    await prefixed(
      new Request(`${ORIGIN}/crud/v1/heroes/v2/json?id=3`, {
        method: "PATCH",
        headers: { "If-Match": '"e1"', "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );

    const [url, init] = base.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/api/crud/crud/v1/heroes/v2/json?id=3`);
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("If-Match")).toBe('"e1"');
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
      '{"name":"Ada"}',
    );
  });

  it("sends no body for a GET and prefixes a manifest path that already starts with /api", async () => {
    const base = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    const prefixed = withApiPrefix(base, ORIGIN);

    await prefixed(new Request(`${ORIGIN}/api/_crud/manifest`));

    const [url, init] = base.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/api/crud/api/_crud/manifest`);
    expect(init?.body).toBeUndefined();
  });

  it("prefixes a plain string and leaves another origin alone", async () => {
    const base = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    const prefixed = withApiPrefix(base, ORIGIN);

    await prefixed("/.well-known/api-catalog");
    await prefixed("https://elsewhere.test/x");

    expect(base.mock.calls[0][0]).toBe(
      `${ORIGIN}/api/crud/.well-known/api-catalog`,
    );
    expect(base.mock.calls[1][0]).toBe("https://elsewhere.test/x");
  });
});

/** Serves the catalog, the manifest and one record, recording the PATCH headers. */
function backend() {
  const patches: (string | null)[] = [];
  const fetchFake = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const { pathname, searchParams } = new URL(request.url);
      const json = (body: unknown, headers: HeadersInit = {}) =>
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json", ...headers },
        });
      if (pathname === "/api/crud/.well-known/api-catalog") {
        return json({
          linkset: [
            {
              describedby: [
                {
                  href: "/api/_crud/manifest",
                  profile:
                    "https://craftainer.github.io/schemas/crud-manifest/v1",
                },
              ],
            },
          ],
        });
      }
      if (pathname === "/api/crud/api/_crud/manifest")
        return json(manifestFixture);
      if (pathname === "/api/crud/crud/v1/heroes/v2/json") {
        if (request.method === "PATCH") {
          patches.push(request.headers.get("If-Match"));
          return json({ ...recordFixtures[0] }, { ETag: '"after"' });
        }
        expect(searchParams.get("id")).toBe("1");
        return json({ ...recordFixtures[0] }, { ETag: '"before"' });
      }
      return new Response(null, { status: 404 });
    },
  );
  return { fetchFake, patches };
}

describe("createCrudApi", () => {
  it("discovers the manifest through /api/crud with the session cookie and X-CSRF, never a token", async () => {
    const { fetchFake } = backend();

    const api = await createCrudApi({
      cacheScope: "u1",
      fetch: fetchFake,
      origin: ORIGIN,
    });

    expect(latestResources(api.manifest).map((r) => r.name)).toEqual([
      "heroes",
    ]);
    const [input, init] = fetchFake.mock.calls[0];
    const first = new Request(input, init);
    expect(first.url).toBe(`${ORIGIN}/api/crud/.well-known/api-catalog`);
    expect(first.headers.get("X-CSRF")).toBe("1");
    expect(first.headers.has("Authorization")).toBe(false);
    expect(first.credentials).toBe("include");
  });

  it("sends X-CSRF on every request, writes included", async () => {
    const { fetchFake } = backend();
    const api = await createCrudApi({
      cacheScope: "u1",
      fetch: fetchFake,
      origin: ORIGIN,
    });
    const heroes = await api.client.resource("heroes");

    await heroes.get(1);
    await heroes.update(1, { name: "Ada" });

    for (const [input, init] of fetchFake.mock.calls) {
      expect(new Request(input, init).headers.get("X-CSRF")).toBe("1");
    }
  });

  it("scopes the cache and the query keys by the given sub", async () => {
    const { fetchFake } = backend();
    const a = await createCrudApi({
      cacheScope: "u1",
      fetch: fetchFake,
      origin: ORIGIN,
    });
    const b = await createCrudApi({
      cacheScope: "u2",
      fetch: fetchFake,
      origin: ORIGIN,
    });

    expect(await a.client.scope()).not.toBe(await b.client.scope());
    expect(await a.client.scope()).not.toBe("anon");
  });

  it("refuses to build a cached client without a cache scope (fail closed)", async () => {
    const { fetchFake } = backend();

    await expect(
      createCrudApi({ cacheScope: "", fetch: fetchFake, origin: ORIGIN }),
    ).rejects.toThrow(/cacheScope/);
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("keys the cache by the sub: one user's cached read is not served to another", async () => {
    const { fetchFake } = backend();
    const a = await createCrudApi({
      cacheScope: "u1",
      fetch: fetchFake,
      origin: ORIGIN,
    });
    const b = await createCrudApi({
      cacheScope: "u2",
      fetch: fetchFake,
      origin: ORIGIN,
    });
    const etagA = etagGetter(a, (await a.client.resource("heroes")).resource);
    const etagB = etagGetter(b, (await b.client.resource("heroes")).resource);

    await (await a.client.resource("heroes")).get(1);

    expect(await etagA(1)).toBe('"before"');
    expect(await etagB(1)).toBeUndefined();
  });

  it("clears what the cache remembers", async () => {
    const { fetchFake } = backend();
    const api = await createCrudApi({
      cacheScope: "u1",
      fetch: fetchFake,
      origin: ORIGIN,
    });
    const heroes = await api.client.resource("heroes");
    await heroes.get(1);
    const etag = etagGetter(api, heroes.resource);
    expect(await etag(1)).toBe('"before"');

    await api.cache.clear();

    expect(await etag(1)).toBeUndefined();
  });

  it("runs onUnauthorized on a final 401 with the attempt and the url", async () => {
    const onUnauthorized = vi.fn();
    const fetchFake = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      createCrudApi({
        cacheScope: "u1",
        fetch: fetchFake,
        origin: ORIGIN,
        onUnauthorized,
      }),
    ).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledWith(expect.any(Response), {
      attempt: 1,
      url: `${ORIGIN}/.well-known/api-catalog`,
    });
  });

  it("supplies the cached ETag of a record read, and the SDK sends it as If-Match", async () => {
    const { fetchFake, patches } = backend();
    const api = await createCrudApi({
      cacheScope: "u1",
      fetch: fetchFake,
      origin: ORIGIN,
    });
    const heroes = await api.client.resource("heroes");
    const etag = etagGetter(api, heroes.resource);

    expect(await etag(1)).toBeUndefined();
    await heroes.get(1);
    expect(await etag(1)).toBe('"before"');

    await heroes.update(1, { name: "Ada" }, { ifMatch: await etag(1) });
    expect(patches).toEqual(['"before"']);
  });
});

describe("latestResources", () => {
  it("keeps the highest api_version of each resource name", () => {
    const [v2] = manifestFixture.resources;
    const manifest = {
      ...manifestFixture,
      resources: [{ ...v2, api_version: "v1" }, v2],
    } as unknown as Parameters<typeof latestResources>[0];

    expect(latestResources(manifest).map((r) => r.api_version)).toEqual(["v2"]);
  });
});
