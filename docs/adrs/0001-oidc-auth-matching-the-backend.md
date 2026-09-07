# 0001. Authenticate via react-oidc-context against the backend's existing Keycloak realm

## Status

Accepted

## Context

This app is the frontend for `template-fastapi`, which already enforces
authorization server-side by validating a bearer JWT on every request
(see that repo's `docs/adrs/0003-auth-strategy-and-federated-backends.md`)
against its own devcontainer Keycloak realm (`template-fastapi`, client
`api`, roles `viewer`/`editor`/`maintainer`). That ADR is explicit that a
frontend's only real job is running the OIDC Authorization Code + PKCE
flow to obtain a token and attaching it as `Bearer` on every request —
any frontend-side role check is a UX convenience layered on top, never
the enforcement point. This app needs a concrete way to do that.

## Decision

We will use `react-oidc-context` (a thin wrapper over `oidc-client-ts`)
as the OIDC client, configured in `src/auth/config.ts` against the
backend's own realm/client rather than standing up a separate identity
provider or auth backend for this app. `main.tsx` wraps the app in
`AuthProvider`; `App.tsx` reads `useAuth()` to gate the UI on
`isAuthenticated`/`isLoading` and drive sign-in/sign-out; `HeroesPage.tsx`
reads `auth.user?.access_token` and passes it as the bearer token on
every backend call (`src/api/client.ts`'s `apiFetch`).

`VITE_OIDC_AUTHORITY`/`VITE_OIDC_CLIENT_ID` default to that same realm/
client (`http://localhost:8080/realms/template-fastapi`, `api`) so a
developer running both repos' devcontainers needs no configuration to
get a working sign-in; overriding either env var points this app at a
different realm without a code change.

This app performs no role checks of its own — it renders whatever the UI
needs and lets the backend's `require_roles` reject anything a signed-in
user's roles don't cover (surfaced to the user via `ApiError`'s RFC 9457
detail, see `src/api/client.ts`). Duplicating role logic here would only
ever be a UX nicety (hiding a button early) and risks drifting out of
sync with the backend's actual role assignments.

## Consequences

- No separate auth backend or session store for this app — one fewer
  moving part, and sign-in/sign-out is entirely the browser talking
  directly to Keycloak via the standard Authorization Code + PKCE flow.
- This app's realm/client defaults are coupled to `template-fastapi`'s
  own devcontainer Keycloak config; a deployment pointing at a different
  backend/realm must set both `VITE_OIDC_AUTHORITY` and
  `VITE_OIDC_CLIENT_ID` (see `.env.example` for local dev, and
  `docs/adrs/0002-same-origin-api-proxy.md`'s runtime-config section for
  how a _built_ image gets these without a rebuild).
- Because no role check happens client-side, a user can see UI for an
  action their role doesn't grant and only learn that from a rejected
  request — acceptable for this worked example; an app with more
  UI surface might add a client-side check later purely as a UX
  optimization, never as the actual gate.
