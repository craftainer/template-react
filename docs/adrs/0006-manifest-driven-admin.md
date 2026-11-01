# 0006. A manifest-driven admin on the CRUD SDK and views

## Status

Accepted

Note (2026-11, ADR 0007): the browser no longer holds an OIDC session. The
token provider and `signinSilent()` in "Client wiring" are replaced by cookie
sessions with the BFF (`credentials: "include"`, `X-CSRF: 1`, `cacheScope` from
`/bff/user`'s `sub`), the `/api` prefix is the BFF's `/api/crud` upstream, and
production no longer uses nginx (the "adds no such header" remark is moot; the
BFF sets its own headers). The query-string navigation here is what ADR 0008's
page views read.

## Context

`HeroesPage` was written for one resource: it hardcoded the Hero columns and
form fields and used a hand-written client (`src/api/crud.ts`) with no
conditional requests, filtering, paging, statistics or revisions. The backend
now publishes a CRUD manifest (template-fastapi ADR 0025) that describes every
resource a caller may see: fields, filter operators, capabilities, paths and
limits. Two libraries consume it: `@craftainer/crud-sdk` (typed client, ETag
cache, TanStack Query helpers) and `@craftainer/crud-views` (MUI views for
list, form, detail, revisions, trash, statistics and predictions). This template uses
both.

Four facts about the libraries and the app shaped the wiring:

- The backend's own paths are absolute (`/crud/...`, and the manifest's
  `/api/_crud/manifest`), but the browser reaches the backend only through the
  same-origin `/api` proxy, which strips that prefix (ADR 0002).
- The SDK cache copies its per-resource policies when it is created, so it can
  only be built after the manifest is known.
- `ResourceForm` takes an `etag(id)` callback (the record query returns only
  the body), and the SDK exposes ETags only through `cache.cachedEtag`, which
  is async. The table's inline edit takes `ifMatch(row)` (async since
  crud-views 0.2.0, item VW5; 0.1.0 needed a synchronous answer the SDK could
  not give), and the list endpoint returns no ETags.
- The app has no router.

## Decision

- **Admin.** `src/pages/AdminPage.tsx` replaces `HeroesPage`. It lists the
  latest `api_version` of each resource in the caller's manifest, one tab per
  resource, and shows only what the manifest's `capabilities` allow: a records
  table with quick search (`ResourceList`), a create dialog and an edit form
  inside the record page (`ResourceForm`, `RecordDetail` with `renderForm`),
  delete (`DeleteAction`), revisions, and tabs for statistics, predictions and
  the trash. Nothing in it names the Hero model. System fields (ids, owner,
  lifecycle and audit timestamps) are left out of the table and shown on the
  record page.
- **Which views.** The admin composes the view families `@craftainer/crud-views`
  ships (list, filter, sort, form, delete, detail, revisions, bulk,
  draft/publish, archive, statistics, predictions). The variants of each were
  chosen from a survey of react-admin, Refine, MUI Toolpad and shadcn blocks,
  keeping what MUI's MIT tier can build (so no multi-sort, calendar or Pro
  grid features) and what the manifest can drive (so no related-record
  editing: the manifest has no relations yet). The admin picks the plain
  variants (paged table, form in the record page, confirm-before-delete); a
  derived app picks others per page from the library's props.
- **Client wiring** (`src/api/sdk.ts`, `src/api/CrudApi.tsx`). The client's
  `baseUrl` is the page origin and its `fetch` puts every same-origin URL under
  `/api`. The token provider reads the OIDC session and calls `signinSilent()`
  on the SDK's refresh. After the manifest loads, the cache is created with
  one `tanstackCachePolicy` per resource and added with `client.use`
  (middleware, then `autoIfMatch`, after the token), so TanStack Query owns
  freshness and the SDK cache only revalidates by ETag. Server-sent events and
  `bridgeEvents` are not wired: the lists refetch on focus and after each
  mutation, which is enough for an admin, and an event stream would need the
  authenticated `fetch` and a second connection per resource.
- **ETags.** `etagGetter` returns `cache.cachedEtag(...)` for the record the
  form just read, and is passed as `etag` to every `ResourceForm` (including
  the one `RecordDetail` mounts). A stale save fails with 412 and the form
  shows the conflict. **Inline edit in the table is on** for callers whose roles
  may write: `rowEtagGetter` reads the record by id (the SDK cache keeps its
  ETag), refuses the edit when that read no longer matches (by `updated_at`, else by the shown fields) the row the user
  edited (the record changed since the list loaded, and an ETag taken now would
  let the edit overwrite that change), and otherwise returns
  `cache.cachedEtag(...)` as `If-Match`; a 412 from a race shows as a save
  error. Because a double click both opens a record and starts an edit,
  opening waits 300 ms and a double click or an edit in progress cancels it.
- **Vite adds `Vary: Origin`.** Vite's dev and preview servers add it to every
  response, proxied ones included, and the SDK cache refuses to store a
  response that varies on anything but Authorization, Accept or
  Accept-Encoding, so no ETag is ever held and saves are unconditional. The
  app is same-origin with its proxy and needs no CORS, so `vite.config.ts` sets
  `server.cors: false` (`preview.cors` follows it). The production image's
  nginx adds no such header.
- **Navigation.** No router dependency (user decision, 2026-10-24). The
  selected resource, view and record are the query parameters `resource`,
  `view` and `id`, read and written through crud-views' `UrlAdapter`
  (`defaultUrlAdapter`, i.e. `window.location` and `history`), the same
  adapter the lists use for filter, sort and paging, so deep links and the back
  button work. Each list prefixes its own parameters with the resource name.
- **Dependencies.** `@craftainer/crud-sdk` 0.5.1, `@craftainer/crud-views` 0.5.1,
  plus `@mui/x-data-grid` and `@mui/x-charts` 9.16.0 (crud-views' peers; MIT
  tier only). The provider's query scope is the OIDC `sub` while
  signed in (stable across token refresh; `AdminPage` also remounts per `sub`)
  and the SDK's `client.namespace()` (`"anon"`) otherwise, because crud-views
  resolves the namespace once per client and does not watch the token. The
  SDK 0.5.0 throws `InsecureTransportError` before sending a request that
  carries a token over plain http to a non-loopback host (loopback hosts such as
  `localhost` are exempt, so local development works over http); the client's
  base URL is the page's own origin, so this only bites when the app is served
  over http from a non-loopback host, and `allowInsecureHttp` is deliberately
  not set: a deployment that serves the app without TLS should fix that rather
  than opt in. Views 0.5 reads the key field from `resource.id_field`, which the
  manifest supplies, so a resource whose id is not called `id` works. The `@craftainer/*` scope is excluded from pnpm's
  `minimumReleaseAge` (user decision, 2026-10-24): we release these ourselves
  and consume them right away.
- **Tests.** Unit tests cover the `/api` prefixing, discovery, the cached ETag
  becoming `If-Match`, and the admin's states (`src/api/sdk.test.ts`,
  `src/pages/AdminPage.test.tsx`). Stories cover the admin's states against a
  fake backend built from a captured real manifest
  (`src/pages/adminStub.ts`), so the real SDK and views run in them.
  `tests/e2e/` runs one journey in a real browser against the BFF
  ([ADR 0007](0007-adopt-craftainer-bff.md)), which serves the built bundle in
  front of a running template-fastapi and its Keycloak: sign in, create,
  conditional edit, a 412 after an out-of-band change, archive and the trash.
  It uses the same pinned Playwright image as the visual suite.
- **Removed.** `HeroesPage`, `src/api/crud.ts` and the hand-written client
  tests. `src/api/heroes.ts` keeps only the `Hero` type, because
  `.storybook/stubs.tsx` (template-owned) imports it.

## Consequences

- Adding a resource to the backend, or a capability to a resource, changes the
  UI without a code change here; the cost is that the admin is generic, so a
  resource that needs a bespoke layout adds its own page next to it.
- The `/api` prefixing `fetch` is the one place that knows about the proxy; it
  re-creates each `Request` (body as a buffer), so streaming request bodies are
  not supported.
- The e2e journey covers inline edit (conditional save, and a refusal after
  an outside change); jsdom cannot render the DataGrid's rows, so the unit
  tests cover `rowEtagGetter` and the stories do not edit cells.
- The e2e needs template-fastapi (MODE=dev, with Postgres and Keycloak), a
  Valkey and Docker for the Playwright image; `tests/e2e/lane.sh` brings them up.
  It is not part of `prek` and runs in the verification lane
  (`tests/e2e/README.md`).
- Without a router, a record or view is not a path (`/heroes/1`); links are
  query strings. Adding a router later means replacing `useUrlParams` and
  passing the router's adapter to the lists.
