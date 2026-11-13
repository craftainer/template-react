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
  with no UI. (Replaced by the amendment below.)

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

## Amendment: the consent prompt (OF1)

The maintainers decided (2026-11-04) to ship a minimal prompt, so that
`ANALYTICS_CONSENT=opt-in` records something. `src/analytics/ConsentBanner.tsx`,
rendered by `App`, wired to `useConsent`:

- **When it shows.** Only when `/bff/config` says `analytics.enabled`, the
  browser sends no GPC / DNT (those events are dropped anyway), and the first
  `GET /bff/consent` has settled. An unreadable `/bff/config` or consent
  endpoint means no analytics knowledge: no prompt when the config is
  unknown, and a prompt (never an assumed yes) when only the stored choice is
  unreadable. It shows in both `implied` and `opt-in` modes, because a
  decline is honoured in both and a visitor should be able to give it.
- **Two equal answers.** "Allow" and "Decline", the same outlined style, no
  accent on either, no pre-ticked state and no way to dismiss it without
  answering. After an answer a quiet "Analytics settings" button remains
  (withdrawing is as easy as giving) and reopens the prompt, showing what is
  stored. It is a non-modal, sticky region at the bottom of the page with the
  design system's ink rule, so it never traps focus; focus moves to the
  prompt when reopened and to the settings button after an answer.
- **The choice stays in the BFF cookie.** The prompt posts `{analytics}` to
  `/bff/consent`; a failed save keeps the previous state, says so and keeps the
  prompt (previously the hook reset to "unknown").
- **One browser flag, decided here.** `GET /bff/consent` returns
  `{analytics: false}` both for a visitor who declined and one who was never
  asked, so the SPA cannot tell whether to ask. A decliner would be asked on
  every visit, which is a nuisance and a dark pattern in itself. The SPA
  therefore stores `analytics.consent.answered = "1"` in `localStorage` after
  a successful save. It is a flag that the question was answered, not the
  answer, holds no identifier, and the BFF cookie still decides; if the flag
  is lost the visitor is asked again. This is the only storage entry the
  analytics code creates, and it supersedes the "no storage entry" line under
  Consequences above for this one flag. A `decided` member on
  `GET /bff/consent` in `@craftainer/bff` would remove the need (recorded as a
  follow-up for lib-bff-ts).
- **Not covered.** The prompt's wording is English only, like the rest of the
  app, and says what is counted rather than naming a legal basis; an
  instance with stricter needs changes the text.
