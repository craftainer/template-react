# FR-0001. Sign in and call the backend through the BFF

## Status

Implemented (the real-Keycloak end-to-end test is BF5's).

## Description

The system shall let a user sign in with the backend's identity provider
and use the admin without any access or refresh token being available to
the page's JavaScript. It shall also record anonymous page views without
identifying the visitor, and it shall honour a browser's Global Privacy
Control and Do Not Track signals.

## Source

The maintainers' decision to use the BFF pattern for the template family
(`docs/plans/2026-10-bff-wellknown-analytics-owasp.md`). No stakeholder
register exists yet. Prompted
[ADR 0007](../adrs/0007-adopt-craftainer-bff.md) and
[ADR 0008](../adrs/0008-spa-analytics-and-consent.md).

## Acceptance criteria

- An anonymous visit shows a sign-in prompt; "Sign in" navigates to
  `/bff/login` and returns the user to the page they were on.
- After sign-in the browser holds one session cookie that is `Secure`,
  `HttpOnly`, `SameSite=Strict`, `__Host-` prefixed, and no token in
  storage, cookies readable by script, or responses.
- A request to `/api/crud/*` without `X-CSRF: 1`, or from another origin, is
  refused; without a session it answers 401 and the SPA goes to sign-in.
- "Sign out" ends the session server-side and the IdP's session; a logout at
  the IdP (back-channel) ends the BFF session too.
- A session that expires or whose refresh is rejected returns the user to
  sign-in rather than showing errors.
- The admin lists and edits records the user's roles allow; the backend
  remains the only authorisation point.
- `/.well-known/security.txt` and `/.well-known/gpc.json` are served when
  configured.
- Navigating the admin sends `page.view` events with paths that contain no
  record id, filter or query; with `Sec-GPC: 1` or `DNT: 1` nothing is
  recorded.
