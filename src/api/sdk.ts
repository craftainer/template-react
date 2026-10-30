// The CRUD SDK (@craftainer/crud-sdk) wired for this app: the BFF's `/api/crud`
// mount, the session cookie (no token in the browser), `X-CSRF` on every
// request, a cache scoped by the signed-in `sub` and the ETag-aware cache. The
// React side is src/api/CrudApi.tsx; see docs/adrs/0006-manifest-driven-admin.md.
import {
  createClient,
  type Middleware,
  findResource,
  type CrudClient,
  type Manifest,
  type Resource,
} from "@craftainer/crud-sdk";
import {
  createCache,
  MemoryStore,
  tanstackCachePolicy,
  type Cache,
} from "@craftainer/crud-sdk/cache";
import { CSRF_HEADER, CSRF_VALUE } from "../auth/bff";

/** The BFF's mount of the `crud` upstream; it strips this before proxying to the backend. */
export const API_PREFIX = "/api/crud";

type Fetch = typeof fetch;

/**
 * Moves a same-origin URL under `/api/crud`. The manifest and the api-catalog
 * give backend paths (`/crud/...`, `/api/_crud/manifest`) that are only
 * reachable here through the proxy, so every one of them gets the prefix.
 */
function prefixed(url: string, origin: string): string {
  const parsed = new URL(url, origin);
  if (parsed.origin !== origin) return url;
  return `${origin}${API_PREFIX}${parsed.pathname}${parsed.search}`;
}

/** A `fetch` that sends every same-origin request through the BFF's `/api/crud`. */
export function withApiPrefix(
  base: Fetch = (input, init) => globalThis.fetch(input, init),
  origin: string = window.location.origin,
): Fetch {
  return async (input, init) => {
    if (input instanceof Request) {
      const hasBody = input.method !== "GET" && input.method !== "HEAD";
      return base(prefixed(input.url, origin), {
        method: input.method,
        headers: input.headers,
        body: hasBody ? await input.clone().arrayBuffer() : undefined,
        signal: input.signal,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        mode: input.mode,
        ...init,
      });
    }
    return base(prefixed(String(input), origin), init);
  };
}

export interface CrudApiOptions {
  /** The signed-in user's `sub`: scopes the SDK cache and the query keys. */
  readonly cacheScope?: string | undefined;
  /** Runs on a final 401 (the session ended): navigate to login. */
  readonly onUnauthorized?: (() => void | Promise<void>) | undefined;
  readonly fetch?: Fetch | undefined;
  readonly origin?: string | undefined;
}

export interface CrudApi {
  readonly client: CrudClient;
  readonly cache: Cache;
  readonly manifest: Manifest;
}

/**
 * Adds `X-CSRF` to every request. It builds the next context from `ctx` so the
 * SDK's `cacheScope` travels on (a fresh context would drop it and the cache
 * would share entries between users).
 */
export const csrf: Middleware = (ctx, next) => {
  const headers = new Headers(ctx.request.headers);
  headers.set(CSRF_HEADER, CSRF_VALUE);
  return next({ ...ctx, request: new Request(ctx.request, { headers }) });
};

/**
 * Builds the client, loads the caller's manifest, then adds the cache. The
 * cache copies its policies when it is created, so it can only be built once
 * the manifest names the resources; `client.use` puts it innermost, after the
 * CSRF middleware.
 */
export async function createCrudApi(options: CrudApiOptions): Promise<CrudApi> {
  const origin = options.origin ?? window.location.origin;
  const client = createClient({
    baseUrl: origin,
    fetch: withApiPrefix(options.fetch, origin),
    credentials: "include",
    // `cacheScope` must be a non-empty string, so a missing `sub` leaves the
    // SDK's own anonymous scope.
    ...(options.cacheScope ? { cacheScope: options.cacheScope } : {}),
    ...(options.onUnauthorized
      ? { onUnauthorized: options.onUnauthorized }
      : {}),
    middleware: [csrf],
  });
  const manifest = await client.manifest();
  // TanStack Query owns freshness, so the SDK cache only revalidates by ETag.
  const policies = Object.fromEntries(
    manifest.resources.map((resource) => [
      `${resource.name}@${resource.api_version}`,
      tanstackCachePolicy(resource),
    ]),
  );
  const cache = createCache({ store: new MemoryStore(), policies });
  client.use(cache.middleware).use(cache.autoIfMatch);
  return { client, cache, manifest };
}

/** The highest `api_version` of each resource the caller may see, in manifest order. */
export function latestResources(manifest: Manifest): Resource[] {
  const names = [...new Set(manifest.resources.map((r) => r.name))];
  return names.flatMap((name) => findResource(manifest, name) ?? []);
}

/**
 * The record's current ETag as the SDK cache holds it (from the last read of
 * that record), for `ResourceForm`'s `etag`. Asked before every save, because
 * a save changes the ETag.
 */
export function etagGetter(
  api: Pick<CrudApi, "client" | "cache">,
  resource: Pick<Resource, "name" | "api_version">,
): (id: number) => Promise<string | undefined> {
  return async (id) =>
    api.cache.cachedEtag(
      resource.name,
      id,
      await api.client.scope(),
      resource.api_version,
    );
}

/** The row as the table showed it: the list endpoint returns no ETags. */
type Row = Readonly<Record<string, unknown>>;

/**
 * The ETag for an inline edit of `row`, for the table's `ifMatch`. The list
 * carries no ETags, so the record is read by id once (the SDK cache keeps its
 * ETag) and `cachedEtag` answers. If that read no longer matches the row the
 * user edited, the record changed since the list loaded and the edit is
 * refused, because an ETag taken now would let it overwrite that change.
 */
export function rowEtagGetter(
  api: Pick<CrudApi, "client" | "cache">,
  resource: Pick<Resource, "name" | "api_version" | "id_field">,
): (row: Row) => Promise<string | undefined> {
  const etag = etagGetter(api, resource);
  return async (row) => {
    const id = Number(row[resource.id_field]);
    const handle = await api.client.resource(
      resource.name,
      resource.api_version,
    );
    const current: Row = await handle.get(id);
    // `updated_at` is the server's own version stamp; without one, compare
    // the fields the row shows.
    const changed =
      "updated_at" in row && "updated_at" in current
        ? row.updated_at !== current.updated_at
        : Object.keys(row).some(
            (key) =>
              key in current &&
              JSON.stringify(current[key]) !== JSON.stringify(row[key]),
          );
    if (changed) {
      throw new Error(
        "This record was changed since the list loaded. Reload the list and try again.",
      );
    }
    const version = await etag(id);
    if (version === undefined) {
      // Not stored (a response the cache refuses): never fall back to an
      // unconditional write.
      throw new Error("Could not read this record's version. Try again.");
    }
    return version;
  };
}
