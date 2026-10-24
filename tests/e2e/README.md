# tests/e2e/

Playwright end-to-end journey of the manifest-driven admin (ADR 0006), in a
real browser against a running `template-fastapi` and its Keycloak.

- `run.sh` — runs the suite in the pinned Playwright image (the one
  `tests/visual/run.sh` uses) with `--network host`. The config builds the app
  and serves it with `vite preview`, whose `/api` proxy points at
  `E2E_API_PROXY_TARGET` (default `http://localhost:8000`). Keycloak's host
  name is resolved on the host and handed to the container; the browser signs
  in through its real login form as the dev realm's `maintainer`.
- `admin.e2e.ts` — the journey: sign in, create, conditional edit, a 412 after
  an out-of-band change, archive and the trash, statistics.
- `playwright.config.ts` — config; `*.e2e.ts` (not `*.spec.ts`, which Vitest
  would pick up).

## Running it

Start `template-fastapi` first (`MODE=dev`, its Postgres and Keycloak up, a
database you may write to), then:

```sh
E2E_API_PROXY_TARGET=http://localhost:8000 tests/e2e/run.sh
```

The backend must be configured with the same Keycloak host name the browser
uses (`http://keycloak:8080/realms/template-fastapi`, the default of
`E2E_OIDC_AUTHORITY`), because it checks the token's issuer. The journey
creates and archives one record per run and never deletes or truncates
anything else.

## Do

- Keep it to journeys that need the real backend; component states belong in
  stories and `src/**/*.test.tsx`.

## Don't

- Run it in `prek` or the unit-test job: it needs the backend and Docker.
