# bff/

The Node server in front of the SPA: a thin app around
[`@craftainer/bff`](https://github.com/craftainer/lib-bff-ts) (OIDC login,
server-side sessions in Valkey, the `/api/<name>/*` proxy, well-known
endpoints, analytics intake, security headers, static files). It is a private
pnpm workspace member (`pnpm-workspace.yaml`: `packages: [".", "bff"]`) with
its own `package.json`, so the image can ship only its production
dependencies (`pnpm --filter ./bff deploy --prod`).

Node runs the TypeScript directly (type stripping): there is no build step.
Use erasable syntax only (no `enum`, `namespace` or parameter properties) and
`.ts` extensions on relative imports (`bff/tsconfig.json` enforces both). `bff/` is not part of the root
`tsc -b`; it has its own `tsconfig.json`.

## Files

- `src/main.ts`: `loadConfig(process.env)`, `buildApp`, `listen` on
  `BFF_HOST:BFF_PORT` (default `0.0.0.0:8080`).
- `src/app.ts`: `buildApp(config, opts?)` calls `createBff` and registers this
  app's own routes (one example, `GET /bff/ping`).
- `src/app.test.ts`: smoke test, run by the root `vitest run`. It builds the
  app in process with the library's in-memory session store, so it needs
  neither Valkey nor an IdP.

## Commands (from the repo root)

```sh
pnpm dev:bff        # node --watch src/main.ts
pnpm start:bff      # node src/main.ts
pnpm typecheck:bff  # tsc -p bff
```

The server needs its configuration in the environment (`PUBLIC_ORIGIN`,
`OIDC_ISSUER`, `OIDC_CLIENT_SECRET`, `SESSION_STORE_URL`, and the optional
variables); `loadConfig` lists every problem at startup. The variables are
documented in the library's README.

## What belongs here, and what belongs in the library

Here:

- App-specific routes (register them in `src/app.ts`, before `listen`).
- Values this app chooses: upstreams (`BFF_UPSTREAMS`), analytics settings,
  the options passed to `createBff`.
- Wiring and tests for those.

In `@craftainer/bff`, not here:

- Anything about how the BFF behaves: login, sessions, CSRF, headers, the
  proxy, health, well-known, analytics, static files.

If the BFF's behaviour is wrong or missing something, fix it in `lib-bff-ts`
and release a patch version, then bump the exact version in
`bff/package.json`. Do not patch around it or copy library code into `bff/`.
