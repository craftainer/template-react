# template-react

> [!NOTE]
> This repository is vibe coded with [Claude](https://claude.com/product/claude-code).

The React frontend for [`template-fastapi`](https://github.com/craftainer/template-fastapi):
Vite + React + TypeScript + MUI, authenticating against that backend's
own Keycloak realm through a Node backend-for-frontend (`bff/`, built on
[`@craftainer/bff`](https://github.com/craftainer/lib-bff-ts)) that keeps the
tokens server-side and proxies `/api/<upstream>/*`. Itself an instance of
[`template-docker`](https://github.com/craftainer/template-docker) (the
shared image layer, itself built on
[`template-base`](https://github.com/craftainer/template-base)) — see
[`docs/TEMPLATE.md`](docs/TEMPLATE.md) for everything about this
repository that's identical across every `template-base` instance
(devcontainer, CI, the release Makefile contract, template sync,
versions/config, code style).

See [`docs/adrs/`](docs/adrs/) for the reasoning behind this app's own
decisions:

- [`0001-oidc-auth-matching-the-backend.md`](docs/adrs/0001-oidc-auth-matching-the-backend.md) —
  superseded by 0007 (browser-side OIDC).
- [`0002-same-origin-api-proxy.md`](docs/adrs/0002-same-origin-api-proxy.md) —
  superseded by 0007 (the nginx `/api` proxy and runtime `config.js`).
- [`0003-re-parent-onto-template-docker.md`](docs/adrs/0003-re-parent-onto-template-docker.md) —
  the image layer from `template-docker`, the `Dockerfile` layout, `image.mk`,
  and the UI dependency set.
- [`0004-design-system-and-token-lint.md`](docs/adrs/0004-design-system-and-token-lint.md) —
  the "Field Ledger" design system in `src/theme/` and the hook that keeps raw
  colors and `px` out of the rest of `src/`; principles in
  [`docs/design/`](docs/design/README.md), the check order in
  [`docs/design/workflow.md`](docs/design/workflow.md).
- [`0005-storybook-visual-regression-and-axe.md`](docs/adrs/0005-storybook-visual-regression-and-axe.md) —
  Storybook for every component, Playwright screenshot baselines and axe
  checks over the stories, rendered in a pinned Playwright image.
- [`0006-manifest-driven-admin.md`](docs/adrs/0006-manifest-driven-admin.md) —
  the admin built on `@craftainer/crud-sdk` and `@craftainer/crud-views`, from
  the backend's CRUD manifest, and its end-to-end test.
- [`0007-adopt-craftainer-bff.md`](docs/adrs/0007-adopt-craftainer-bff.md) —
  the BFF: cookie sessions, no tokens in the browser, the Node runner image.
- [`0008-spa-analytics-and-consent.md`](docs/adrs/0008-spa-analytics-and-consent.md) —
  page views and events through the BFF, implied consent, GPC/DNT.

Requirements: [`FR-0001`](docs/frs/FR-0001-sign-in-through-the-bff.md);
the services and how they connect: [`docs/architecture.md`](docs/architecture.md).

## Getting started

Open this repository in its devcontainer (VS Code's "Reopen in
Container", or `devcontainer up`) — `postCreateCommand`
(`scripts/post-create.sh`) installs the git hooks (`prek install`) and,
via `scripts/post-create.d/10-pnpm-install.sh`, the dependencies
automatically. Then:

```sh
pnpm dev:bff    # the dev BFF on :8787 (needs Keycloak, the backend and Valkey)
pnpm dev        # Vite dev server, http://localhost:5173 (proxies to the BFF)
pnpm typecheck  # tsc -b
pnpm typecheck:bff  # tsc -p bff
pnpm lint       # oxlint
pnpm format     # prettier --check .
pnpm test       # vitest run
pnpm build      # production bundle -> dist/
pnpm storybook  # component workshop, http://localhost:6006
tests/visual/run.sh         # visual regression + axe over the stories (Docker)
tests/visual/run.sh update  # rewrite the screenshot baselines
tests/e2e/run.sh            # admin journey against a running template-fastapi (Docker)
```

## Connecting to the backend

The browser never talks to the backend, or to Keycloak with a token: it
talks to the BFF on its own origin (`/bff/*` for sign-in and session,
`/api/crud/*` for the backend), so the backend needs no CORS and the page
holds no token. See
[`docs/adrs/0007-adopt-craftainer-bff.md`](docs/adrs/0007-adopt-craftainer-bff.md);
in short:

- **Both repos' devcontainers open side by side** (the common case): no
  configuration needed. `.devcontainer/compose.instance.yml` gives the dev
  BFF (`pnpm dev:bff`, port 8787) its environment: the backend at
  `http://host.docker.internal:8000` (`BFF_UPSTREAMS`), template-fastapi's
  Keycloak realm at port 8080, its dev-only `bff` client secret, and the
  Valkey service. `pnpm dev` then serves the SPA on 5173 and proxies
  `/bff`, `/api` and `/.well-known` to the BFF.
- **Backend running directly on the host**: export the variables in
  `.env.example` (`BFF_UPSTREAMS` with `http://localhost:8000`).
- **Another BFF address for Vite**: `VITE_BFF_PROXY_TARGET` in `.env`.

### Runtime configuration

The BFF reads real environment variables (there is no `config.js` and no
build-time OIDC setting). It refuses to start without:

| Variable             | Meaning                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`      | Browser-facing origin, e.g. `https://app.example.com`; derives the redirect URI and the Origin check.   |
| `OIDC_ISSUER`        | The expected `iss` of the IdP's tokens (the realm URL).                                                 |
| `OIDC_CLIENT_SECRET` | Secret of the confidential `bff` client.                                                                |
| `SESSION_STORE_URL`  | Valkey/Redis URL; `rediss://` outside local dev (plaintext needs `SESSION_STORE_ALLOW_PLAINTEXT=true`). |

Also commonly set: `BFF_UPSTREAMS` (JSON allowlist, `crud` by default
mounted at `/api/crud/*`), `OIDC_DISCOVERY_URL` (when the BFF reaches the IdP
at another host than `iss`), `ANALYTICS_*` and `SECURITY_TXT_*`. Every
variable is documented in the
[`@craftainer/bff` README](https://github.com/craftainer/lib-bff-ts#configuration).

## Production image and releases

The runtime image is the top-level `Dockerfile`'s `runner` stage
(`docker build --target runner .`): a digest-pinned Node image running
`bff/` as the unprivileged `node` user on port 8080, serving the built SPA.
Run it with the required variables above, publishing container port 8080 on
host port 8081 (`-p 8081:8080`, with `PUBLIC_ORIGIN=http://localhost:8081`),
because 8080 is Keycloak in the devcontainer. `/health/live` needs neither Valkey nor the
IdP. `.devcontainer/Dockerfile` only builds the devcontainer. `release.yml` drives the template-docker-owned
`Makefile` (tuned by this repo's `image.mk`), which builds it natively for
`amd64` and `arm64`, smoke-tests each image, and, when the `OCI_REGISTRY`
repository variable is set (e.g. `ghcr.io`), copies the tested images to
per-arch tags and combines them into one multi-arch
`<registry>/<owner>/template-react:<version>` tag. Registry credentials
are the `OCI_REGISTRY_USERNAME` / `OCI_REGISTRY_PASSWORD` secrets — for
GHCR, a personal access token with `write:packages`.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
