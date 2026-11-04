# tests/e2e/

Playwright end-to-end tests of the production topology (ADR 0007): the built
SPA served by the BFF (`bff/src/main.ts`, a thin app around
`@craftainer/bff`), signing in through a **real Keycloak** login form, with
sessions in a **real Valkey** and the `/api/crud` proxy in front of a **real
`template-fastapi`**. Nothing is mocked and nothing is token-aware in the
browser.

- `lane.sh` — brings the backing services up and down (below).
- `run.sh` — runs the suite in the pinned Playwright image (the one
  `tests/visual/run.sh` uses).
- `playwright.config.ts` — config. Its `webServer` starts two BFFs from this
  repo's `bff/` (`node bff/src/main.ts`, logs to `/tmp/bff-*.log`): `main` on
  `http://localhost:8081` (long sessions, `ANALYTICS_BACKEND=log`,
  `SECURITY_TXT_CONTACT`, `CHANGE_PASSWORD_URL`) and `short` on
  `http://localhost:5173` (`SESSION_IDLE_SECONDS=6`,
  `SESSION_ABSOLUTE_SECONDS=15`). Those two origins are the ones the realm's
  `bff` client allows as redirect URIs. `*.e2e.ts`, not `*.spec.ts`, which
  Vitest would pick up.
- `global-setup.ts` — before the run, sets the realm's access-token lifespan to
  40 s (the BFF refreshes within 30 s of expiry) and points the `bff` client's
  back-channel logout URL at the BFF under test; afterwards it restores both.
- `lane.ts` — helpers: sign-in through the Keycloak form, the session cookie, a
  bare RESP client for the lane's Valkey (`GET sess:<id>`), the BFF log
  reader, Keycloak's admin API.
- `lane.compose.yml` — the override that makes template-fastapi's `myapp` run the
  API.
- The specs, by what they settle:
  - `session.e2e.ts` — the `__Host-Http-session` cookie's attributes (`HttpOnly`,
    `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`), that the browser holds no
    token, `GET /bff/user`, the security headers and SPA fallback, 401s and a
    forged cookie, a missing `X-CSRF` (403 `csrf_rejected`), a foreign `Origin` or
    `Sec-Fetch-Site` (403 `origin_rejected`), no CORS, and logout (cookie cleared,
    session gone from Valkey, the refresh token revoked at Keycloak, the Keycloak
    SSO session ended).
  - `backchannel.e2e.ts` — an admin logout of a user at Keycloak ends that user's
    BFF sessions (two browsers, two `sid`s) through the signed logout token, and
    the endpoint refuses anything unsigned without needing `X-CSRF`.
  - `refresh.e2e.ts` — an expiring access token is refreshed once under eight
    racing requests: `sess:<id>` goes from `version` 0 to 1 (the Lua
    compare-and-set against Valkey), with rotated tokens and the lock released; a
    refresh Keycloak rejects ends the session.
  - `expiry.e2e.ts` — the idle timeout (a sliding Valkey TTL) and the absolute
    timeout, on the `short` BFF.
  - `wellknown.e2e.ts` — `security.txt`, `change-password` (302), `gpc.json`,
    `api-catalog`, the JSON 404, `/bff/config`, `/health/*`.
  - `analytics.e2e.ts` — `POST /bff/analytics`: empty 202 for an accepted and for a
    dropped event (`Sec-GPC: 1`, `DNT: 1`, consent cookie `0`), 400 for a prop key off
    the allowlist and other malformed events, 413 above 16 KB, 403 without
    `X-CSRF`; and the SPA's page views carry bare paths such as
    `/heroes/trash`, never ids or queries.
  - `admin.e2e.ts` — the manifest-driven admin (ADR 0006) through the BFF: create,
    conditional inline and form edits, a 412 after an out-of-band change, archive
    and the trash, statistics.

## How the lane is built

No stack service is started that a repo's own compose files do not define, and
none beside them:

| Piece                               | From                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Keycloak (realm `template-fastapi`) | template-fastapi's `.devcontainer/stack/keycloak`                                                  |
| Postgres, S3, MQTT                  | template-fastapi's stack (the API needs them)                                                      |
| Valkey (`redis://<ip>:6379`)        | template-fastapi's `redis` stack service: the same image and command as this repo's `stack/valkey` |
| The API (`MODE=dev`, `uvicorn`)     | template-fastapi's `myapp` service, with `lane.compose.yml` on top                                 |
| Selenium, Umami                     | not started                                                                                        |
| The BFFs and the browser            | this repo, in the Playwright image                                                                 |

`lane.sh up` runs `docker compose` over template-fastapi's
`.devcontainer/compose.yml` and `compose.instance.yml` plus `lane.compose.yml`
with `--no-deps` (its `depends_on` also lists Selenium). The suite's container
joins **Keycloak's network namespace** (`--network container:<keycloak>`), so
`localhost:8080` is Keycloak for the browser, the BFFs and the tokens' `iss`
alike, and Keycloak can call the BFF's back-channel logout on `localhost:8081`.
A lane has no VS Code to forward ports, which is why this repo's
devcontainer setup (`host.docker.internal`) is not reused. The API and Valkey are
addressed by container IP, which `run.sh` looks up.

```sh
# 1. The SPA the BFF serves.
pnpm exec vite build
# 2. A clean, git-only checkout of template-fastapi's main (the realm with the
#    `bff` client is in it), outside any workspace that is in use.
E2E_FASTAPI_DIR=/path/to/template-fastapi-checkout tests/e2e/lane.sh up
# 3. The suite.
tests/e2e/run.sh            # extra arguments go to `playwright test`
# 4. Everything down: containers, volumes and the built API image.
E2E_FASTAPI_DIR=/path/to/template-fastapi-checkout tests/e2e/lane.sh down
```

The lane needs about 2 GB of memory (Keycloak alone is about 0.6 GB; the API,
Postgres, RustFS, Valkey, Mosquitto and the Playwright container with Chromium
make up the rest), so keep other heavy work off the machine while it runs. The
suite itself takes roughly 5 minutes; the first `lane.sh up` also builds
template-fastapi's devcontainer image and runs `uv sync`. The journeys create and
archive one hero per run and never delete or truncate anything else; `down -v`
discards the database anyway.

## Do

- Keep it to journeys that need the real Keycloak, Valkey or backend; component
  states belong in stories and `src/**/*.test.tsx`, and the BFF's own logic in
  `@craftainer/bff`'s tests.
- Use `raw()` from `lane.ts` for requests that must control every header
  (`Cookie`, `Origin`, `Sec-Fetch-Site`, `X-CSRF`) instead of Playwright's cookie
  jar, and `idle(page)` before waiting on session timeouts: the SPA polls, and a
  poll counts as activity.
- Give each spec its own dev-realm user where it ends sessions at Keycloak (the
  back-channel spec owns `viewer`).

## Don't

- Run it in `prek` or the unit-test job: it needs Docker and a lane.
- Work around a defect of `@craftainer/bff` here or in `bff/`. A failing test that
  shows one goes back to `lib-bff-ts` as a fix and a patch release.
