# Adopt template-base v1.2.3's instance model

## Status

In progress — steps 2–6 done on `chore/adopt-template-base-v1.2`
(local v1.0.0 → v1.2.3 apply, checks and an arm64 `make build sbom
release-assets` + image smoke test pass). Remaining: devcontainer
rebuild, the post-merge repo settings and sync bootstrap (step 7), then
the upstream fixes (step 1).

Update 2026-10-30: the sign-in/issuer check (former step 8) moved to
the template-base plan
[`2026-10-bff-wellknown-analytics-owasp.md`](https://github.com/craftainer/template-base/blob/main/docs/plans/2026-10-bff-wellknown-analytics-owasp.md),
item BK1 (that file lives in the template-base workspace until it is
committed there).

## Goal

This repo was forked from `template-base` v1.0.0 and has no
`.github/template-sync-state.json`, so it has never synced. Since then
`template-base` (now v1.2.3) changed how instances extend it: base-owned
files (`Dockerfile`, `scripts/develop.sh`, `.devcontainer/compose.yml`,
`release.yml`, ...) are `replace` tier and must not be edited in an
instance, which instead uses hook files. This repo edits all of those
directly, so the first sync would overwrite its runtime image, Corepack
setup, `pnpm install` step, and GHCR publishing. This plan moves those
customizations into the hooks, brings the repo up to v1.2.3, and turns
on template sync. `template-fastapi` went through the same steps in
93c9a5a and #23/#24.

## What changed upstream (v1.0.0 → v1.2.3)

- **Instance extension points** (`docs/TEMPLATE.md`, "Instance extension
  points"): `scripts/develop.d/*.sh` (run by the base `Dockerfile`),
  `scripts/post-create.d/*.sh` (run by the new `scripts/post-create.sh`,
  now the `postCreateCommand`), `.devcontainer/compose.instance.yml`
  (second `dockerComposeFile` entry), and a separate `app.Dockerfile`
  (+ `app.Dockerfile.dockerignore`) for the runtime image.
- **Dev service renamed `app` → `myapp`** (Chrome HSTS-preloads `.app`).
- **Release contract grew**: `release-arches` (JSON list, runs first),
  `build`/`sbom`/`release-assets`/`publish` run per arch on native
  runners with `RELEASE_ARCH` set, then `release-check` (inside the
  devcontainer) and `finalize` (e.g. a multi-arch manifest list).
  Publishing is configured through `OCI_REGISTRY`/`OCI_IMAGE_NAME` vars
  and `OCI_REGISTRY_USERNAME`/`OCI_REGISTRY_PASSWORD` secrets. The
  workflow no longer has `packages: write` and doesn't log in to GHCR.
- **Tiers changed**: `.gitignore`, `.dockerignore`,
  `.pre-commit-config.yaml`, `.mcp.json` and the manifest itself are now
  `merge` (they were `replace` in this repo's manifest). A non-template
  instance lists its own paths in
  `.github/template-sync-manifest.local.yml`. This repo is itself a
  template, so it keeps editing its own manifest instead.
- **New checks/scripts**: `check_devcontainer_lock.py` (prek hook), and
  the issue-moderation split into read-only run + `*-apply.yml`
  workflows (`moderate_apply_result.sh`, `moderate_package_result.sh`).
- **Template sync** pushes with the `TEMPLATE_SYNC_TOKEN` secret
  (`GITHUB_TOKEN` can't write `.github/workflows/`).
- Version bumps (`PYTHON_VERSION` 3.14.0 → 3.14.7 here, `NODE_VERSION`
  24.20.0 → 24.21.0, prek, Claude Code CLI, snip, uv).

## Approach

In-repo steps 2–7 come first; step 1's upstream fixes follow once this
repo is on v1.2.3.

### 1. Upstream fixes (after this repo's own migration)

In `template-base`:

- **Bug, confirmed**: `template_sync.py` lists the new template's files
  with `rglob("*")` (line 141), not `git ls-files`, and the workflow runs
  it from inside `/tmp/template-new/.github/scripts`, so Python's own
  `__pycache__/template_sync_manifest.*.pyc` gets synced as a `replace`
  file (it appears in template-fastapi's #24). Fix: enumerate with
  `git -C <ref> ls-files`. Passing `-B` would also stop the `.pyc`, but
  any other untracked file would still be synced.
- **Renovate** (`renovate.json` is `merge` tier, so every instance
  patches it by hand today): widen the Dockerfile manager to
  `/^(app\.)?Dockerfile$/` and add a `Makefile` manager for
  `# renovate:` + `NAME_VERSION := x`. Both come straight from
  template-fastapi's 93c9a5a. Base documents `app.Dockerfile` and the
  `Makefile` contract, but its Renovate config covers neither.
- _(Optional)_ `docs/TEMPLATE.md`: an instance formatter (prettier here)
  must exclude base-owned files, or every sync will fail its check. See
  step 5.

Nothing in `template-fastapi` has to change for the base migration
itself. The one auth issue found during review (token issuer) moved to
the template-base plan (see Status).

### 2. Move customizations into the hooks (this repo, before syncing)

| Currently in (base-owned)                                        | Moves to (instance-owned)                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile` `builder`/`runner` stages, `NGINX_VERSION` ARG      | `app.Dockerfile` (own `NODE_VERSION`, `DEBIAN_VERSION`, `NGINX_VERSION` ARGs; drop unused `APP_UID`)                                    |
| `.dockerignore`'s `node_modules`/`dist`                          | `app.Dockerfile.dockerignore`. BuildKit uses it _instead of_ `.dockerignore`, so it needs the full list; revert `.dockerignore` to base |
| `scripts/develop.sh`'s `corepack enable`                         | `scripts/develop.d/10-corepack.sh`                                                                                                      |
| `devcontainer.json` `postCreateCommand`'s `pnpm install`         | `scripts/post-create.d/10-pnpm-install.sh`                                                                                              |
| `compose.yml`'s `extra_hosts: host.docker.internal:host-gateway` | `.devcontainer/compose.instance.yml` under `services.myapp`                                                                             |

Add `scripts/check-dockerfile-versions.sh` plus a prek hook, like
template-fastapi's. It fails when `NODE_VERSION`/`DEBIAN_VERSION` differ
between `Dockerfile` and `app.Dockerfile`: the builder must use the same
Node the devcontainer tests with.

Rewrite `Makefile` to the full v1.2 contract, using template-fastapi's
as the model: `release-arches` printing `["amd64", "arm64"]`; `build` with
`docker buildx build -f app.Dockerfile --target runner --platform
linux/$(RELEASE_ARCH)` to an arch-suffixed OCI tar in `dist/`; `sbom`
(Syft on the tar, `SYFT_VERSION :=` so the Makefile Renovate manager
matches); `publish` pushing `:$(RELEASE_VERSION)-$(RELEASE_ARCH)` when
`OCI_REGISTRY` is set; `release-check` running `pnpm test`; `finalize`
running `docker buildx imagetools create` for the multi-arch tag. This
replaces the GHCR login and `packages: write` that were added to
`release.yml`, which a sync would overwrite.

### 3. Apply v1.0.0 → v1.2.3 locally, on a branch

Run base's own sync logic by hand instead of letting the first
scheduled run open a huge conflicted PR:

```sh
git clone --branch v1.0.0 https://github.com/craftainer/template-base /tmp/old
git clone --branch v1.2.3 https://github.com/craftainer/template-base /tmp/new
cd /tmp/new/.github/scripts && python3 -B template_sync.py apply \
  --manifest /tmp/new/.github/template-sync-manifest.yml \
  --old-ref /tmp/old --new-ref /tmp/new --instance-root /workspace
```

`replace` files are overwritten. That's fine after step 2, since what's
left in them is formatting noise (see step 5) and `release.yml`'s GHCR
additions (replaced by step 2's `Makefile`). Expect conflict markers in
the `merge` files. Resolve them as follows:

- `devcontainer.json`: `name`, `forwardPorts`/`portsAttributes`, the
  prettier extension and editor settings stay; `service: myapp`, both
  compose files, `postCreateCommand: bash /workspace/scripts/post-create.sh`
  come from base.
- `.pre-commit-config.yaml`: keep the `check-yaml`/`check-json` excludes
  and the oxlint/prettier/tsc/vitest hooks, and add base's
  `devcontainer-lock` hook and step 2's `check-dockerfile-versions` hook.
- `renovate.json`: base's three managers, with the app.Dockerfile and
  Makefile patterns from step 1 unless those have landed upstream.
- `.gitignore`, `.dockerignore`, `README.md`, `docs/TEMPLATE.md`,
  `scripts/README.md`, `.vscode/README.md`, `.github/workflows/README.md`,
  `.claude/README.md`: keep both sides' additions.
- `.github/template-sync-manifest.yml`: see step 4.

### 4. Rebuild this repo's own manifest

This manifest classifies files for this repo's _downstream_ React
instances. Start from base v1.2.3's manifest (updated header wording)
and add this repo's own paths, following template-fastapi's choices for
the same kinds of files:

- `replace`: `app.Dockerfile`, `app.Dockerfile.dockerignore`, `Makefile`,
  `.devcontainer/compose.instance.yml`, `scripts/develop.d/10-corepack.sh`,
  `scripts/post-create.d/10-pnpm-install.sh`,
  `scripts/check-dockerfile-versions.sh`, `scripts/docker/`,
  `.prettierignore`, `.oxlintrc.json`, `tsconfig*.json`,
  `vite.config.ts`, `vitest.config.ts`, `index.html`,
  `.vscode/launch.json`.
- `ignore`: `pnpm-lock.yaml`, `.env.example`, `src/` (a downstream app's
  own code is never overwritten by a sync; the generic CRUD client and
  Heroes example are a starting point it owns from instantiation on).
- `merge`: `package.json` (and every base `merge` entry).
- Drop the stale `docker/` and `public/` patterns (moved in 97476ed). The
  completeness check doesn't flag patterns that match nothing.

### 5. Stop prettier from rewriting base-owned files

`pnpm format` / the `prettier-check` hook run `prettier --check .`, which
has already rewritten base-owned markdown (`*x*` → `_x_`, list
continuation indents in `CLAUDE.md`, `docs/TEMPLATE.md`,
`.github/workflows/README.md`, prompts, ...). Every sync puts base's
formatting back and fails the hook. Add a `.prettierignore` covering
base-owned paths (`CLAUDE.md`, `docs/TEMPLATE.md`, `docs/*/README.md`,
`docs/*/template.md`, `.github/`, `.claude/`, `.devcontainer/`,
`.secrets/`, `scripts/*.md`, `scripts/*.d/README.md`), so prettier only
formats this repo's own files.

### 6. Update this repo's docs

- `README.md`, `docs/adrs/0002-same-origin-api-proxy.md`: `extra_hosts`
  now lives in `compose.instance.yml`; the backend's dev service is now
  `myapp` (it still forwards port 8000, so nothing functional changes);
  the production image is built from `app.Dockerfile`.
- `scripts/README.md`, `.devcontainer/README.md`, `.vscode/README.md`:
  describe the new hook files; drop "extend `develop.sh`".

### 7. Verify

Rebuilding the devcontainer is required and only the user can trigger
it. After that:

- `prek run --all-files --hook-stage manual` (includes the manifest,
  lockfile, Dockerfile-version, oxlint, prettier, tsc and vitest hooks).
- `RELEASE_VERSION=0.0.0-test RELEASE_TAG=v0.0.0-test RELEASE_ARCH=amd64
make release-arches build sbom release-assets`. Check that `dist/` holds
  an arch-suffixed `.tar` and `.spdx.json`.
- Smoke-test the image: `docker run` it and `curl` `/`, `/config.js`
  and `/api/health` against the backend.

After merging:

- Set `TEMPLATE_SYNC_TOKEN`, `TEMPLATE_SYNC_INTERVAL`,
  `OCI_REGISTRY=ghcr.io`, and `OCI_REGISTRY_USERNAME` plus a PAT with
  `write:packages` as `OCI_REGISTRY_PASSWORD`.
- Run `template-sync.yml` with `initial_sync_tag=v1.2.3`,
  `template_repo=craftainer/template-base`. That opens the bootstrap
  PR, and later syncs are incremental.

## Decisions

- Release arches: `amd64` and `arm64`, both native runners.
- GHCR auth: a PAT in `OCI_REGISTRY_PASSWORD`; no upstream change to
  `release.yml` needed.
- `src/` is `ignore` tier for downstream instances (step 4).
- 2026-10-30: step 8 (frontend sign-in against template-fastapi, the
  `iss`/`KC_HOSTNAME` issue) moved to the template-base plan
  [`2026-10-bff-wellknown-analytics-owasp.md`](https://github.com/craftainer/template-base/blob/main/docs/plans/2026-10-bff-wellknown-analytics-owasp.md),
  item BK1 (user decision of 2026-10-29). That file lives in the
  template-base workspace until committed.
