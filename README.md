# template-react

> [!NOTE]
> This repository is vibe coded with [Claude](https://claude.com/product/claude-code).

The React frontend for [`template-fastapi`](https://github.com/craftainer/template-fastapi):
Vite + React + TypeScript + MUI, authenticating against that backend's
own Keycloak realm and talking to it exclusively through a same-origin
`/api` proxy. Itself an instance of
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
  auth via `react-oidc-context` against the backend's existing realm.
- [`0002-same-origin-api-proxy.md`](docs/adrs/0002-same-origin-api-proxy.md) —
  the `/api` proxy (dev and prod), cross-repo dev networking, and the
  production image's runtime-configurable settings.
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

## Getting started

Open this repository in its devcontainer (VS Code's "Reopen in
Container", or `devcontainer up`) — `postCreateCommand`
(`scripts/post-create.sh`) installs the git hooks (`prek install`) and,
via `scripts/post-create.d/10-pnpm-install.sh`, the dependencies
automatically. Then:

```sh
pnpm dev        # Vite dev server, http://localhost:5173
pnpm typecheck  # tsc -b
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

This app never talks to the backend directly from the browser — every
request goes through a same-origin `/api` proxy (`vite.config.ts` in
dev, `scripts/docker/nginx.conf.template` in the built image), so the backend
never needs CORS configured for this app. See
[`docs/adrs/0002-same-origin-api-proxy.md`](docs/adrs/0002-same-origin-api-proxy.md)
for the full reasoning; in short:

- **Both repos' devcontainers open side by side** (the common case): no
  configuration needed. `VITE_API_PROXY_TARGET` defaults to
  `http://host.docker.internal:8000`, reaching `template-fastapi`'s own
  devcontainer via its forwarded port 8000.
- **Backend running directly on the host** instead of in its own
  devcontainer: copy `.env.example` to `.env` and set
  `VITE_API_PROXY_TARGET=http://localhost:8000`.
- **Sign-in**: `VITE_OIDC_AUTHORITY`/`VITE_OIDC_CLIENT_ID` (also in
  `.env.example`) default to the backend's own devcontainer Keycloak
  realm/client — no configuration needed for the same common case above.

The built production image takes the equivalent settings as real
container env vars instead (`API_PROXY_TARGET`, `OIDC_AUTHORITY`,
`OIDC_CLIENT_ID`) — see the ADR's "Runtime-configurable production
image" section.

## Production image and releases

The runtime image is the top-level `Dockerfile`'s `runner` stage
(`docker build --target runner .`); `.devcontainer/Dockerfile` only builds
the devcontainer. `release.yml` drives the template-docker-owned
`Makefile` (tuned by this repo's `image.mk`), which builds it natively for
`amd64` and `arm64`, smoke-tests each image, and, when the `OCI_REGISTRY`
repository variable is set (e.g. `ghcr.io`), copies the tested images to
per-arch tags and combines them into one multi-arch
`<registry>/<owner>/template-react:<version>` tag. Registry credentials
are the `OCI_REGISTRY_USERNAME` / `OCI_REGISTRY_PASSWORD` secrets — for
GHCR, a personal access token with `write:packages`.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
