# 0007. Adopt `@craftainer/bff`: cookie sessions behind a Node server, no tokens in the browser

## Status

Accepted. Supersedes [0001](0001-oidc-auth-matching-the-backend.md) and
[0002](0002-same-origin-api-proxy.md).

## Context

Until now the browser ran the OIDC Authorization Code + PKCE flow itself
(`react-oidc-context`), held the access token in JavaScript and sent it as a
bearer token through an nginx `/api` proxy whose settings were rendered at
container start by `envsubst` into `config.js` (ADRs 0001 and 0002). Three
things made that a poor base for a template:

- Tokens reachable from JavaScript are readable by any script that runs in
  the page (OWASP A02/A07; the current OAuth browser-based-apps guidance and
  RFC 10017 on the BFF pattern recommend keeping them out of the browser).
- The nginx image could not hold a session, check `Origin`, serve
  `/.well-known/*`, or receive analytics events, and the `envsubst` config
  path was a second configuration mechanism next to Vite's.
- The same server-side pieces are wanted by every UI template, so they belong
  in a library (`@craftainer/bff`, repository `craftainer/lib-bff-ts`).

## Decision

We will run a Node server in front of the SPA, built from the library, and
the SPA holds no tokens:

- **Library plus a thin `bff/`.** `bff/` is a private pnpm workspace member
  that calls `loadConfig(process.env)` and `createBff`, adds this app's own
  routes and listens (`bff/README.md`). Behaviour (login, sessions, CSRF,
  headers, proxy, well-known, analytics, static files) stays in the library; a
  defect there is fixed in the library and released, not patched in `bff/`.
  The version is pinned exactly in `bff/package.json`.
- **Login.** The BFF is the confidential OIDC client (`bff`) of
  template-fastapi's Keycloak realm. The browser holds one `__Host-Http-`
  session cookie (`Secure; HttpOnly; SameSite=Strict`); sessions, refresh
  tokens and login transactions live in Valkey. `PUBLIC_ORIGIN`, never the
  `Host` header, derives `redirect_uri` and the Origin check.
- **SPA contract.** `GET /bff/user` (401 means "navigate to `/bff/login`"),
  `GET /bff/login?returnTo=`, `POST /bff/logout`, `GET /bff/config`. Every
  `/api/*` request and every non-GET `/bff/*` request carries `X-CSRF: 1`.
  Roles from `/bff/user` are for the UI only; the backend still authorises.
- **API access.** `BFF_UPSTREAMS` is an allowlist; the default instance has
  one upstream, `crud`, mounted at `/api/crud/*` (prefix stripped). The BFF adds
  `Authorization: Bearer`, refreshing the token when needed. The browser never
  sees it, and inbound `Authorization`/`Cookie` headers are never forwarded.
  This keeps ADR 0002's reason: same origin, so no CORS on the backend.
- **Dev.** Vite (5173) proxies `/bff`, `/api` and `/.well-known` to the dev BFF
  (8787, `pnpm dev:bff`), whose environment comes from
  `.devcontainer/compose.instance.yml`. The BFF reaches the sibling backend
  (port 8000) and Keycloak (port 8080) through `host.docker.internal`, as
  ADR 0002 set up. Valkey is a stack service (`.devcontainer/stack/valkey/`).
- **Image.** `Dockerfile` builds the SPA and `pnpm --filter ./bff deploy
--prod`, then runs `node src/main.ts` (type stripping, no build step) as
  the unprivileged `node` user on a digest-pinned `node:*-slim` image, port 8080. npm, npx and corepack are removed from the runner. The smoke test is
  `/health/live`, which needs neither Valkey nor the IdP.
- **Configuration.** Required at runtime: `PUBLIC_ORIGIN`, `OIDC_ISSUER`,
  `OIDC_CLIENT_SECRET`, `SESSION_STORE_URL` (`rediss://` outside the dev
  stack). `loadConfig` lists every problem at startup. There is no
  `config.js`, no `VITE_OIDC_*` and no `envsubst`.

## Consequences

- No access or refresh token is ever reachable from script, and sessions can
  be ended server-side (logout, expiry, back-channel logout).
- A deployment now needs Valkey (or a compatible store) and a client secret,
  and its IdP must register `<PUBLIC_ORIGIN>/bff/callback` and the back-channel
  logout URL. Losing Valkey signs everyone out.
- The BFF is one more process to patch: library releases arrive through
  Renovate as exact-version bumps.
- Rate limits are in memory, per replica, until a Valkey-backed limiter is
  shown to work. The visitor-token for analytics has the same replica limit.
- Static serving and the security headers move from nginx into the library,
  so the CSP is the library's; an app that needs a different one changes it
  through the library.
- Moving between hosts or origins changes `PUBLIC_ORIGIN` and the realm's
  redirect URIs together. Image runs on a developer machine use host port 8081
  (`8081:8080`), because 8080 is Keycloak.

## Amendment: the CSP style nonce (BF5c)

The library's fixed `style-src 'self'` blocked Emotion's runtime `<style>`
tags, so the SPA rendered unstyled behind the BFF. From `@craftainer/bff`
0.2.0 the library serves the SPA's HTML with a per-request nonce, and the SPA
passes it on:

1. `vite.config.ts` sets `html.cspNonce: "__CSP_NONCE__"`. Vite adds that
   value to its own `<script>` and `<link>` tags and emits
   `<meta property="csp-nonce" nonce="__CSP_NONCE__">`.
2. The BFF replaces every `__CSP_NONCE__` in `index.html` per request and
   sends `style-src-elem 'self' 'nonce-<n>'; style-src-attr 'unsafe-inline'`
   (`script-src 'self'` is unchanged), with the HTML `no-store`. Other
   responses keep the old CSP. The library's ADR 0005 has the reasoning.
3. `src/theme/emotionCache.ts` reads the nonce from the meta tag's `.nonce`
   property (browsers hide the attribute from `getAttribute`) and builds the
   Emotion cache with `{ key: "mui", nonce, prepend: true }`, per MUI's CSP
   guide. `ThemeProvider` wraps the app in `CacheProvider`.

`style-src-attr 'unsafe-inline'` stays because MUI and the data grid set
`style=""` attributes, which a nonce cannot cover. Under `vite dev` the
placeholder stays literal and no CSP is enforced; with no meta tag (unit
tests, Storybook) the cache simply has no nonce.

## Amendment: 401 loop guard, session teardown, accepted gaps (OF1)

**Cache scope and `onUnauthorized` (crud-sdk 0.9).** The client is built with
`createClient({ cache })`, `cacheScope` set to `/bff/user`'s `sub` and
`onUnauthorized(response, { attempt, url })`. A cached cookie client without a
scope throws at construction in 0.9, and the app goes further: with no `sub` it
builds no cached client at all and shows an error (fail closed). The data is
per user, so `cacheScope: "shared"` (meant for public data) is not used.

**One login bounce per tab (`src/auth/unauthorized.ts`).** A final 401 used to
navigate to `/bff/login` without limit; while the identity provider's own
session lives, a signed-in user the API rejects (audience mismatch, a role the
upstream refuses) looped between the SPA, the BFF and the provider, once per
open tab. Now the first 401 stores a timestamp in `sessionStorage` and
redirects; a second 401 (a marker younger than ten minutes, or the SDK's
`attempt` above 1) shows "signed in, but not authorised" with a manual
"Sign in again" button. The marker survives the navigations and reloads of the
bounce; a request that succeeds, an explicit sign-in or a logout clears it. A
marker that is unreadable, malformed, from the future, or storage that is
unavailable counts as "already bounced" (fail closed: an error with a button,
never a loop). It holds a timestamp only.

**Logout and user change.** The SDK does not notice a session change, so
`src/auth/teardown.ts` keeps a registry. `CrudApiProvider` registers the
clearing of the SDK cache (`cache.close()`, `cache.clear()`) and the TanStack
query cache; logout runs the registry after the BFF ended the session and
before navigating to the provider. A failed `POST /bff/logout` leaves the
caches alone (the session is live) and the app bar says "Could not sign you
out". The same clearing runs when the provider unmounts or the `sub` changes,
and a client built for another `sub` is never handed out. The app opens no
event hub today; any future `invalidateOnEvents` / `subscribeEvents`
unsubscribe is registered in the same registry.

**Startup.** `/bff/config` gets a ten second timeout; past it the app starts
with an empty config instead of a blank page. An empty config means no
analytics prompt until a reload; the BFF still decides what is recorded (under
`opt-in`, nothing without consent; under `implied`, as before the prompt
existed).

**`MODE`.** The "apps refuse to start when `MODE` is unset" decision (OWASP
triage, 2026-11-04) applies to apps with a mode switch. This BFF has none: its
only switch is `NODE_ENV`, which the image sets to `production` and which the
library reads to refuse plaintext Valkey and an insecure IdP. Nothing is added
here. Under `vite dev` / `pnpm dev:bff` an unset `NODE_ENV` is the development
mode, and that default belongs to the library (recorded as a follow-up for
lib-bff-ts: refuse an unset `NODE_ENV` too).

**Accepted: the BFF e2e is a local lane only (Medium).** The tests under
`tests/e2e/` need template-fastapi's Keycloak and API, so no CI workflow runs
them. Renovate's automerge of `@craftainer/bff` (patch and minor, after three
days, with prek and CodeQL green) stays on, so a library regression in a cookie
flag, the CSRF check or the CSP reaches `main` unless the lane was run first.
Accepted by the maintainers on 2026-11-04; mitigated by running
`tests/e2e/lane.sh` before releases and when bumping the library by hand.

## Amendment: the remaining OWASP Lows (OWLOW)

The OWASP review of 2026-11-04 (OW-template-react, 21 Lows) was triaged in two
steps: the auth, session, consent and startup findings shipped with the OF1
amendment above; the rest are settled here.

**Fixed.**

- The runner's `FROM` had drifted from the builder's Node (24.22.1 against
  24.22.2). It is realigned, and `bff/src/dockerfile.test.ts` (part of
  `vitest run`) fails when the two differ again.
- The BFF handles `SIGTERM` and `SIGINT` (`bff/src/shutdown.ts`): it stops
  accepting, lets running requests finish and exits, instead of waiting out
  the grace period for a `SIGKILL` with node as PID 1.
- A tab asks `/bff/user` again when it becomes visible, because the cookie is
  shared by every tab: a second sign-in as another user, or a sign-out, no
  longer leaves the first tab showing the old name and records. Only a 401 or a
  user changes the state; a failed check keeps it.
- `.env` and `.env.*` are in `.dockerignore`, so a developer's local file never
  enters the builder stage (a `VITE_` secret there would have reached the
  bundle).
- `BFF_TRUST_PROXY` is documented (README, `.env.example`).
- `osv-scanner.toml` named the dev-only tree for an advisory that is no longer
  present (minimatch 10 is gone since the `glob@13>minimatch` override); that
  ignore is removed and the other one names the runtime tree it excludes.
- `vitest.config.ts` caps the pool at two workers, and a `tsc -p tests/e2e`
  hook (`pnpm typecheck:e2e`) type-checks the e2e specs, which no hook covered.

**Accepted, with the reason.**

- `fetchUser().catch(() => null)` on first load treats a failed `/bff/user` as
  signed out. A visitor with a broken BFF can do nothing but sign in anyway,
  and the sign-in navigation reports the real failure; the later re-checks
  (above) do not downgrade a signed-in tab.
- `viewPath` sends the pathname as is (ADR 0008 states it). This app has no
  routes with ids or emails in the path; an instance that adds some must
  filter them in `pageViews.ts`.
- `prefixed()` in `src/api/sdk.ts` leaves a cross-origin URL alone. The SDK
  follows absolute links of the backend's manifest and catalog, and the BFF's CSP
  (`default-src 'self'`, which `connect-src` falls back to; asserted by
  `tests/e2e/session.e2e.ts`) is the guard;
  the session cookie is host-only and `SameSite=Strict`, so it is never sent to
  another origin.
- No image `HEALTHCHECK`. Release images are copied with skopeo in OCI format,
  which has no such field, and Kubernetes ignores it; the probes are
  `/health/live` and `/health/ready`, which the image-smoke run already uses.
- The builder and `bff-deploy` bases are pinned by tag, not digest. They only
  produce the bundle and the pruned `node_modules`, from a locked install with
  a release-age gate; the image that serves requests (the runner) is
  digest-pinned. A digest per stage doubles Renovate's churn for no
  runtime exposure.
- The dev Valkey is `valkey/valkey:9.1.2-alpine` by tag without a password, on
  the compose network, with `SESSION_STORE_ALLOW_PLAINTEXT`. Development only;
  the library refuses plaintext under `NODE_ENV=production`.
- `.devcontainer/compose.instance.yml` is `replace` tier in the template-sync
  manifest although it mixes template and instance values. A sync shows the
  file in its diff, and an instance that edits it moves it to `ignore` in its
  own manifest (as `bff/` is). Fixing the tier is template-docker's decision.
- Renovate's automerge of `@craftainer/bff` and its exclusion from
  `minimumReleaseAge`: first-party, with the e2e lane (see the amendment
  above) as the gate for a cookie, CSRF or CSP regression.
- Inherited from template-docker, tracked in its OW report and not changed
  here: `chmod 0777` on the DAST work directory (`scripts/image-dast.sh`) and
  the tag-only `hadolint` image in `.pre-commit-config.yaml`.
