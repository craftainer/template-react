# 0008. SPA analytics: page views and events through the BFF, consent decided server-side

## Status

Accepted

## Context

The app wants privacy-preserving usage numbers (which admin views are used),
without an analytics script from a third party, cookies set from JavaScript,
or identifiers in the browser. The BFF already sees the request (IP, user
agent, GPC and DNT headers) and owns the analytics intake (`POST
/bff/analytics`, adapters `none`, `log`, `umami`, `otel`; `@craftainer/bff`
ADR 0004), so the open questions were what the browser sends, who decides
whether an event counts, and how page views work without a router (ADR 0006).

## Decision

- **The browser sends events, nothing else.** `src/analytics/track.ts`:
  `track(name, props?, url?)` POSTs to `/bff/analytics` with `fetch`, using
  `keepalive` and the `X-CSRF: 1` header (never `sendBeacon`, which cannot
  carry the header). The name matches the dotted lower-case pattern, values
  are scalars of at most 200 characters, and `url` is a bare path. The browser
  sends no id, title, referrer or query string.
- **Fail closed.** `track()` never throws into the UI, never retries, and stays
  quiet for five minutes after a transport failure or throttling. It also skips
  the request when `navigator.globalPrivacyControl` is true or Do Not Track is
  `1`; the BFF drops such requests as well (`ANALYTICS_RESPECT_GPC`), so
  neither side trusts the other.
- **Consent is decided by the BFF.** The default mode is `implied`: events
  count unless the visitor declined, the legitimate-interest posture that
  fits an audience-measurement tool configured to the CNIL exemption
  conditions (first-party, no cross-site tracking, no raw IP, short-lived
  pseudonymous token, a purpose limited to audience measurement). The
  choice lives in the BFF's `__Host-Http-consent` cookie: `1` granted, `0`
  declined (`0` stops recording in every mode, including `implied`). The SPA
  reads and sets it through `GET`/`POST /bff/consent` (`useConsent`); `null`
  means unknown and is treated as "not granted" by the SPA's own sends. A
  deployment that needs prior consent sets `ANALYTICS_CONSENT=opt-in` with no
  SPA change.
- **No ids in page paths.** There is no router, so a "page" is the pathname
  plus the admin's resource and view from the `UrlAdapter` query state (ADR
  0006), e.g. `/heroes/trash`. Record ids, filters and paging never leave
  the browser; a record page reports `/heroes/record`. `usePageViews()` is
  called once in `App` and sends one `page.view` per distinct reported path,
  so a filter change sends nothing.
- **Properties are allowlisted server-side** (`ANALYTICS_PROP_KEYS`, default
  empty), so adding a property is a deliberate change on both sides.
- **No consent banner yet.** The default needs none. Whether and how to ask
  is a design decision for the maintainers; until then `useConsent` exists
  with no UI.

## Consequences

- No cookie, storage entry or id is created by the SPA's analytics; the only
  cookie is the BFF's consent cookie, and only when a choice is stored.
- Page-view counts under `implied` consent include visitors who never saw a
  choice; a deployment in a stricter setting must switch to `opt-in` and add
  the UI first, or no events will be recorded.
- `viewPath` sends the pathname as is, so a path containing an id would be
  reported; the admin's paths do not. A router later must map routes to
  templates before reporting.
- Dev and CI default to `ANALYTICS_BACKEND=none`; pointing it at Umami
  needs `ANALYTICS_ENDPOINT` and `ANALYTICS_SITE_ID`.
