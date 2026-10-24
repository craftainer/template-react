# 0006. A manifest-driven admin on the CRUD SDK and views

## Status

Accepted

## Context

`HeroesPage` was written for one resource: it hardcoded the Hero columns and
form fields and used a hand-written client (`src/api/crud.ts`) with no
conditional requests, filtering, paging, statistics or revisions. The backend
now publishes a CRUD manifest (template-fastapi ADR 0025) that describes every
resource a caller may see: fields, filter operators, capabilities, paths and
limits. Two libraries consume it: `@craftainer/crud-sdk` (typed client, ETag
cache, TanStack Query helpers) and `@craftainer/crud-views` (MUI views for
list, form, detail, revisions, trash, statistics and predictions). The plan
(`docs/plans/2026-10-templates-sdks-ui.md`, item UI4) has this template use
both.

Four facts about the libraries and the app shaped the wiring:

- The backend's own paths are absolute (`/crud/...`, and the manifest's
  `/api/_crud/manifest`), but the browser reaches the backend only through the
  same-origin `/api` proxy, which strips that prefix (ADR 0002).
- The SDK cache copies its per-resource policies when it is created, so it can
  only be built after the manifest is known.
- `ResourceForm` takes an `etag(id)` callback (the record query returns only
  the body), and the SDK exposes ETags only through `cache.cachedEtag`, which
  is async. The table's inline edit takes `ifMatch(row)`, which in
  crud-views 0.1.0 must be synchronous, and the list endpoint returns no ETags.
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
  shows the conflict. **Inline edit in the table stays off** (user decision,
  2026-10-24): 0.1.0's synchronous `ifMatch` cannot ask the SDK for a row's
  ETag, and an inline edit without one would be an unconditional PATCH. Item
  VW5 makes `ifMatch` accept a promise (crud-views 0.2.0); this app then bumps
  the pin, passes an `ifMatch` that fetches the row by id once and returns
  `etagGetter(...)(id)`, and sets `INLINE_EDIT` in `AdminPage.tsx`.
  **Status: pending VW5.**
- **Vite adds `Vary: Origin`.** Vite's dev and preview servers add it to every
  response, proxied ones included, and the SDK cache refuses to store a
  response that varies on anything but Authorization, Accept or
  Accept-Encoding. Under `pnpm dev` no ETag is ever held, so saves are
  unconditional there; the production image's nginx adds no such header. The
  e2e serves the bundle with `tests/e2e/vite.preview.config.ts`
  (`preview.cors: false`). Setting `server.cors: false` in `vite.config.ts`
  would fix `pnpm dev` too; that file is outside this item's write set.
- **Navigation.** No router dependency (user decision, 2026-10-24). The
  selected resource, view and record are the query parameters `resource`,
  `view` and `id`, read and written through crud-views' `UrlAdapter`
  (`defaultUrlAdapter`, i.e. `window.location` and `history`), the same
  adapter the lists use for filter, sort and paging, so deep links and the back
  button work. Each list prefixes its own parameters with the resource name.
- **Dependencies.** `@craftainer/crud-sdk` and `@craftainer/crud-views` 0.1.0,
  plus `@mui/x-data-grid` and `@mui/x-charts` 9.16.0 (crud-views' peers; MIT
  tier only). The `@craftainer/*` scope is excluded from pnpm's
  `minimumReleaseAge` (user decision, 2026-10-24): we release these ourselves
  and consume them right away.
- **Tests.** Unit tests cover the `/api` prefixing, discovery, the cached ETag
  becoming `If-Match`, and the admin's states (`src/api/sdk.test.ts`,
  `src/pages/AdminPage.test.tsx`). Stories cover the admin's states against a
  fake backend built from a captured real manifest
  (`src/pages/adminStub.ts`), so the real SDK and views run in them.
  `tests/e2e/` runs one journey in a real browser against a running
  template-fastapi and its Keycloak: sign in, create, conditional edit, a 412
  after an out-of-band change, archive and the trash. It uses the same pinned
  Playwright image as the visual suite, serving the built bundle with
  `vite preview`.
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
- Until VW5, rows cannot be edited in the table, only on the record page. The
  e2e journey and the stories do not cover inline edit.
- The e2e needs a running template-fastapi (MODE=dev, Postgres and Keycloak)
  and Docker for the Playwright image; it is not part of `prek` and runs in the
  verification lane (`tests/e2e/README.md`).
- Without a router, a record or view is not a path (`/heroes/1`); links are
  query strings. Adding a router later means replacing `useUrlParams` and
  passing the router's adapter to the lists.
