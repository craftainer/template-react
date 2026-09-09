# 0002. Reach the backend through a same-origin /api proxy, not CORS

## Status

Accepted

## Context

This app calls a backend that lives in a separate repo/origin
(`template-fastapi`), from two different runtime shapes: the Vite dev
server during development, and a static bundle served by nginx in the
built production image. Either the backend allows cross-origin requests
from this app's origin (CORS), or this app makes every request look
same-origin and something in front of it forwards `/api/*` to the real
backend. The dev server also needs to run alongside the backend's own
devcontainer, a _separate_ `docker compose` project on the same host with
no shared network by default (each devcontainer is its own isolated
compose stack — see `.devcontainer/README.md`'s "Docker-in-Docker vs. the
host's Docker").

## Decision

We will proxy `/api/*` to the backend at both layers instead of
configuring CORS on the backend:

- **Dev**: `vite.config.ts` proxies `/api` to `VITE_API_PROXY_TARGET`,
  stripping the `/api` prefix. `src/api/client.ts`'s `apiFetch` always
  fetches `/api${path}`, so the app code never knows or cares where the
  backend actually is.
- **Prod**: the `runner` stage's nginx (`scripts/docker/nginx.conf.template`)
  proxies `/api/` the same way, to `API_PROXY_TARGET`, alongside serving
  the built SPA with a history-mode fallback.

`VITE_API_PROXY_TARGET` defaults to `http://host.docker.internal:8000`:
since this app's devcontainer and the backend's are separate compose
projects, there is no project network to name the backend's `api`
service on directly. The backend's own `devcontainer.json` already
forwards its `api` service's port 8000 to the _host_; `host.docker.internal`
(reachable via `compose.yml`'s `extra_hosts: host.docker.internal:host-gateway`,
which works the same on Docker Desktop and Linux Docker Engine) reaches
that forwarded port from inside this app's own container. This avoids
adding a `networks:`/`ports:` block to `compose.yml` (see
`.devcontainer/README.md`'s "Don't") and needs no change to the backend
repo at all. A developer running the backend directly on the host
instead of in its own devcontainer overrides `VITE_API_PROXY_TARGET` to
`http://localhost:8000` in `.env` (see `.env.example`).

Because a proxy — not CORS — fronts the backend in both environments,
the backend needs no `Access-Control-Allow-Origin` configuration for
this app at all, in dev or prod.

### Runtime-configurable production image

The same "app doesn't know where the backend is" principle extends to
the OIDC settings baked into `src/auth/config.ts`
(`docs/adrs/0001-oidc-auth-matching-the-backend.md`). Those are normally
Vite build-time env vars, which would otherwise mean rebuilding the
image to point a deployed instance at a different realm/client. Instead,
the `runner` stage generates `src/public/config.js.template` →
`/usr/share/nginx/html/config.js` via `envsubst` from real container env
vars on every container _start_ (the same templating mechanism nginx's
own base image already provides for `nginx.conf.template`, run once more
against this app-level template); `index.html` loads `config.js` before
the app bundle, and `src/auth/config.ts` reads
`window.__APP_CONFIG__?.oidcAuthority ?? import.meta.env.VITE_OIDC_AUTHORITY`
(same pattern for the client ID) so a built image is reconfigured by
changing its container env vars, not by rebuilding. Dev is unaffected —
there's no `config.js` there, so `window.__APP_CONFIG__` is `undefined`
and Vite's own env vars apply directly.

### Future: a real deployment doesn't use host.docker.internal

`host.docker.internal` only makes sense for two sibling devcontainers on
one developer's machine — it's a dev-time convenience, not a deployment
story. A real (non-devcontainer) deployment of this app's `runner` image
is expected to set `API_PROXY_TARGET` (and `OIDC_AUTHORITY`) to wherever
`template-fastapi` is actually reachable from — once that backend
publishes a built image to GitHub Container Registry, most likely that
published image's own deployed address, not anything devcontainer- or
compose-network-specific. No `networks:`/`ports:` change to either
repo's `.devcontainer/compose.yml` is needed for this — the dev-time
setup above and a real deployment's config are already decoupled via env
vars for exactly this reason. Not yet implemented; noted here so the
next instance of this decision doesn't have to be rediscovered.

## Consequences

- The backend stays CORS-free for this app in every environment; the
  proxy is the only thing that needs to know the backend's real address,
  and that address is itself overridable without a code change (env var
  in dev, container env var in prod).
- `host.docker.internal` requires Docker Desktop, or Docker Engine
  20.10+ with the `host-gateway` `extra_hosts` entry `compose.yml`
  already sets — negligible risk for a devcontainer-based workflow, but
  worth knowing if the dev stack ever moves to a from-scratch Compose
  setup outside a devcontainer.
- Reaching the backend through its _host-forwarded_ port (rather than a
  shared container network) means this app's dev server only works
  against a backend that's actually running with that port forwarded —
  fine for the sibling-devcontainer workflow this defaults to, less
  fine for, say, a from-scratch multi-repo CI job, which would need its
  own explicit network wiring instead of relying on these defaults.
- The production image needs its real OIDC/API settings supplied as
  container env vars at deploy time (`OIDC_AUTHORITY`, `OIDC_CLIENT_ID`,
  `API_PROXY_TARGET`) — omitting them falls back to the same devcontainer
  defaults baked into the templates, which is only correct for a local
  smoke-test of the image, not a real deployment.
