// A fake of the backend endpoints the admin calls (api-catalog, manifest and
// the heroes JSON router), for stories and unit tests. It replaces
// `window.fetch`, so the real SDK client, cache and views run unchanged.
import { manifestFixture, recordFixtures } from "./adminFixtures";

type Row = Record<string, unknown> & { id: number };

export interface AdminStubOptions {
  /** `"none"`: the caller may see no resource (an empty manifest). */
  readonly manifest?: "heroes" | "none" | "denied";
  /** The records; `"pending"` never answers the list (the loading state). */
  readonly records?: readonly Row[] | "pending";
}

export interface AdminStub {
  /** The fake `fetch`; `installAdminStub` also assigns it to `window.fetch`. */
  fetch: typeof fetch;
  /** Every request the admin made, as `METHOD path?query`. */
  readonly calls: string[];
  /** The `If-Match` header of each PATCH, in order (`null` when absent). */
  readonly ifMatch: (string | null)[];
}

const API = "/api";
const HEROES = `${API}/crud/v1/heroes/v2/json`;

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const etagOf = (row: Row, version: number) => `"${row.id}-${version}"`;

export function installAdminStub(options: AdminStubOptions = {}): AdminStub {
  const { manifest = "heroes", records = recordFixtures } = options;
  const stub: AdminStub = {
    fetch: () => Promise.reject(new Error("not installed")),
    calls: [],
    ifMatch: [],
  };
  const rows: Row[] =
    records === "pending" ? [] : records.map((r) => ({ ...(r as Row) }));
  const versions = new Map<number, number>();
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;

  stub.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    stub.calls.push(`${request.method} ${path}${url.search}`);

    if (path === `${API}/health/live`) return json(200, { status: "ok" });
    if (path === `${API}/.well-known/api-catalog`) {
      return json(
        200,
        {
          linkset: [
            {
              anchor: url.origin,
              describedby: [
                {
                  href: "/api/_crud/manifest",
                  type: "application/json",
                  profile:
                    "https://craftainer.github.io/schemas/crud-manifest/v1",
                },
              ],
            },
          ],
        },
        { "Content-Type": "application/linkset+json" },
      );
    }
    if (path === `${API}/api/_crud/manifest`) {
      if (manifest === "denied") {
        return json(403, { title: "Forbidden", status: 403 });
      }
      return json(200, {
        ...manifestFixture,
        resources: manifest === "none" ? [] : manifestFixture.resources,
      });
    }
    if (!path.startsWith(HEROES)) return json(404, { title: "Not stubbed" });

    const sub = path.slice(HEROES.length);
    const id = Number(url.searchParams.get("id"));
    const row = rows.find((r) => r.id === id);

    if (sub === "/stats") {
      return json(200, {
        total: rows.length,
        numeric: [
          {
            field: "power_level",
            count: rows.length,
            minimum: 41,
            maximum: 72,
            average: 56.5,
            total: 113,
          },
        ],
        categorical: [
          { field: "is_locked", value: "False", count: rows.length },
        ],
        time_series: null,
        lifecycle: {
          archived: 0,
          draft: 0,
          locked: 0,
          scheduled_pending: 0,
          scheduled_expired: 0,
        },
      });
    }
    if (sub === "/revisions") return json(200, []);
    if (sub !== "") return json(404, { title: "Not stubbed" });

    if (request.method === "GET") {
      if (url.searchParams.has("id")) {
        return row
          ? json(200, row, { ETag: etagOf(row, versions.get(id) ?? 0) })
          : json(404, { title: "Not Found", status: 404 });
      }
      if (records === "pending") return new Promise<Response>(() => {});
      const skip = Number(url.searchParams.get("skip") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return json(200, rows.slice(skip, skip + limit));
    }
    if (request.method === "POST") {
      const created: Row = {
        ...recordFixtures[0],
        ...((await request.json()) as object),
        id: nextId++,
      };
      rows.push(created);
      return json(201, created, { ETag: etagOf(created, 0) });
    }
    if (request.method === "PATCH" && row) {
      const precondition = request.headers.get("If-Match");
      stub.ifMatch.push(precondition);
      if (
        precondition !== null &&
        precondition !== etagOf(row, versions.get(id) ?? 0)
      ) {
        return json(412, { title: "Precondition Failed", status: 412 });
      }
      Object.assign(row, await request.json());
      const version = (versions.get(id) ?? 0) + 1;
      versions.set(id, version);
      return json(200, row, { ETag: etagOf(row, version) });
    }
    if (request.method === "DELETE" && row) {
      rows.splice(rows.indexOf(row), 1);
      return new Response(null, { status: 204 });
    }
    return json(404, { title: "Not Found", status: 404 });
  };
  window.fetch = stub.fetch;
  return stub;
}
