import { describe, expect, it, vi } from "vitest";
import { manifestFixture, recordFixtures } from "../pages/adminFixtures";
import {
  createCrudApi,
  etagGetter,
  rowEtagGetter,
  latestResources,
  withApiPrefix,
} from "./sdk";

const ORIGIN = "https://app.test";

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

    const api = await createCrudApi({ fetch: fetchFake, origin: ORIGIN });

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
    const api = await createCrudApi({ fetch: fetchFake, origin: ORIGIN });
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
    const anon = await createCrudApi({ fetch: fetchFake, origin: ORIGIN });

    expect(await a.client.scope()).not.toBe(await b.client.scope());
    expect(await anon.client.scope()).toBe("anon");
    expect(await a.client.scope()).not.toBe("anon");
  });

  it("runs onUnauthorized on a final 401", async () => {
    const onUnauthorized = vi.fn();
    const fetchFake = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      createCrudApi({ fetch: fetchFake, origin: ORIGIN, onUnauthorized }),
    ).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it("supplies the cached ETag of a record read, and the SDK sends it as If-Match", async () => {
    const { fetchFake, patches } = backend();
    const api = await createCrudApi({
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

describe("rowEtagGetter", () => {
  async function setup() {
    const { fetchFake } = backend();
    const api = await createCrudApi({
      fetch: fetchFake,
      origin: ORIGIN,
    });
    const heroes = await api.client.resource("heroes");
    return { api, resource: heroes.resource };
  }

  it("reads the record once and returns the ETag the server gave", async () => {
    const { api, resource } = await setup();

    const etag = await rowEtagGetter(api, resource)({ ...recordFixtures[0] });

    expect(etag).toBe('"before"');
  });

  it("refuses an edit when the cache holds no ETag for the record", async () => {
    const { api, resource } = await setup();
    const noEtags = {
      client: api.client,
      cache: { cachedEtag: async () => undefined },
    } as unknown as Parameters<typeof rowEtagGetter>[0];

    await expect(
      rowEtagGetter(noEtags, resource)({ ...recordFixtures[0] }),
    ).rejects.toThrow(/version/);
  });

  it("compares shown fields when a row has no updated_at", async () => {
    const { api, resource } = await setup();
    const { updated_at: _omitted, ...row } = recordFixtures[0];
    void _omitted;

    await expect(rowEtagGetter(api, resource)(row)).resolves.toBe('"before"');
    await expect(
      rowEtagGetter(api, resource)({ ...row, name: "Older name" }),
    ).rejects.toThrow(/changed since the list loaded/);
  });

  it("refuses an edit of a row that changed since the list loaded", async () => {
    const { api, resource } = await setup();

    await expect(
      rowEtagGetter(
        api,
        resource,
      )({ ...recordFixtures[0], updated_at: "2025-12-31T00:00:00Z" }),
    ).rejects.toThrow(/changed since the list loaded/);
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
