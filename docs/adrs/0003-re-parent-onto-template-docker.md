# 0003. Re-parent onto template-docker, move the app image to `Dockerfile`, and add the UI dependency set

## Status

Accepted

## Context

template-react was an instance of `template-base` that carried its own
release `Makefile`, `scripts/check-dockerfile-versions.sh` and a separate
`app.Dockerfile` (+ `app.Dockerfile.dockerignore`) for the runtime image,
because base's top-level `Dockerfile` was the devcontainer image. Every
image-shipping template (fastapi, axum, react) repeated that image plumbing.
`template-docker` v1.0.0 is the shared image layer on top of base: the
devcontainer image lives in `.devcontainer/Dockerfile`, the top-level
`Dockerfile` is the instance's runtime image, and a template-owned `Makefile`
implements the release contract (OCI build, SBOM, labels, smoke test, publish
of the tested tar with skopeo) tuned by an optional instance-owned `image.mk`
(its ADR 0001). The UI layer also needs
Storybook, Playwright, axe, Motion, self-hosted fonts and TanStack Query, and
wants them, with the lockfile, in one reviewable change before the items that
use them (UI1 onward) run in parallel.

## Decision

We will sync from `template-docker` (`.github/template-sync-state.json`:
`craftainer/template-docker`, `v1.0.0`) and stay a template ourselves, editing
`.github/template-sync-manifest.yml` directly (it started as docker's and adds
react's own paths, so every tracked path is classified).

**Layout upgrade (one time).** `app.Dockerfile` becomes the top-level
`Dockerfile`; `app.Dockerfile.dockerignore` is deleted and its excludes
(`node_modules`, `coverage`) join the merge-tier `.dockerignore`. The
devcontainer image is now `.devcontainer/Dockerfile` (docker/base's, replace
tier). `NODE_VERSION` in `Dockerfile` follows `.devcontainer/Dockerfile`'s
(24.22.0); `scripts/check-dockerfile-versions.sh DEBIAN_VERSION NODE_VERSION`
keeps them equal. The builder also copies `pnpm-workspace.yaml` (see below).
The runner stays nginx-unprivileged (it does not use `runner-setup.sh`), now on
`1.30.6-alpine` (was `1.27.4-alpine`): the manual-stage `image-scan` hook
(Trivy, HIGH/CRITICAL with a fix) rejected the old base's libraries.

**`image.mk`** (merge tier, so instances can add values) sets only what differs
from docker's defaults:

| Variable                    | Value                                       | Why                                                                                                                                       |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `IMAGE_SMOKE_PORT`          | `8080`                                      | nginx-unprivileged                                                                                                                        |
| `IMAGE_SMOKE_PATH`          | `/`                                         | the SPA's `index.html`                                                                                                                    |
| `IMAGE_SMOKE_RUN_ARGS`      | `-e API_PROXY_TARGET=http://127.0.0.1:8000` | nginx exits on an unresolvable upstream, and the image's default `host.docker.internal` does not resolve in a plain `docker run` on Linux |
| `release-check: unit-tests` | `unit-tests:` runs `pnpm test`              | the old `release-check` recipe, now a prerequisite beside docker's `image-smoke`                                                          |

`DOCKERFILE`, `TARGET`, `ARCHES` (`amd64 arm64`) and `OCI_LICENSE`
(`GPL-3.0-or-later`) keep docker's defaults. No `BUILD_ARGS` (the bundle
embeds no version or commit) and no `COVERAGE_REPORT` (no coverage asset is
released), so the coverage label is omitted.

**Moved or deleted.** Deleted: `app.Dockerfile`, `app.Dockerfile.dockerignore`
and the repo's own release `Makefile` recipes (docker's `Makefile` replaces
them; labels now include `url`, `sbom` and the SPDX `GPL-3.0-or-later` id, and
publish copies the tested tar instead of rebuilding). Old
`check-dockerfile-versions.sh` (which took no arguments) is replaced by docker's.
New, replace-tier from docker: `scripts/image-smoke.sh`, `runner-setup.sh`,
`runner-setup.d/README.md`, `skopeo.sh`, `image-scan.sh`, `.devcontainer/Dockerfile`
and `.devcontainer/Dockerfile.dockerignore`, plus base's newer files (agents,
skills, workflows, `develop.sh`, compose, lock). In the manifest, react's
`Dockerfile`, `.devcontainer/compose.instance.yml` and its two hook scripts are
`replace` for react's instances; `image.mk`, `package.json` and
`pnpm-workspace.yaml` are `merge`.

**Dependencies** (exact versions, as the rest of `package.json`; installed with
pnpm 12.3.4 and locked; no config, stories, theme or tests yet, those are UI1
and later):

| Package                                                                 | Version | Kind | Purpose                                                                                                               |
| ----------------------------------------------------------------------- | ------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `storybook`, `@storybook/react-vite`, `@storybook/addon-a11y`           | 10.6.3  | dev  | component workshop on the existing Vite 8 (the builder supports `^8`) and React 19; the a11y addon runs axe per story |
| `@playwright/test`                                                      | 1.64.1  | dev  | e2e and visual tests                                                                                                  |
| `@axe-core/playwright`                                                  | 4.14.0  | dev  | accessibility assertions inside Playwright                                                                            |
| `motion`                                                                | 14.4.0  | prod | animation. 14.5.0 is current but was under a day old; see below                                                       |
| `@fontsource-variable/fraunces`, `@fontsource-variable/instrument-sans` | 5.3.0   | prod | self-hosted "Field Ledger" fonts (variable builds exist), no third-party font requests                                |
| `@tanstack/react-query`                                                 | 5.104.5 | prod | server-state cache for the CRUD UI                                                                                    |

We stay on MUI (plan decision P-D4). `@fontsource/roboto` stays until UI1 swaps
the theme's fonts.

Update: UI1 (ADR 0004) swapped the fonts and removed `@fontsource/roboto`.

`pnpm-workspace.yaml` (new, merge tier) sets `allowBuilds: { esbuild: false }`.
pnpm 12 fails an install on an unreviewed dependency build script, and
Storybook pulls in esbuild, whose postinstall is only a fast path (its binary
comes from per-platform optional packages). `pnpm-lock.yaml` is run through
Prettier after `pnpm add`, as it was before, because `prettier --check .`
covers it.

## Consequences

- Release behaviour is preserved (static nginx image, per-arch build, SBOM,
  labels, multi-arch tag) and gains an image smoke test in `release-check`,
  per-arch smoke before publish, and publishing of the tested artifact.
  Publishing needs `skopeo`, run from a pinned image by docker's script.
- Future template-docker releases arrive through template sync; the
  `Makefile` and image scripts are no longer edited here. Per-repo values
  go in `image.mk`.
- Anything referencing `app.Dockerfile` must use `Dockerfile` now; the other
  Track UI templates' instances inherit the same layout.
- The dependency set adds roughly 100 packages. `motion` is pinned one minor
  behind the newest release because pnpm's `minimumReleaseAge` supply-chain
  gate rejects packages published under a day ago; do not add an
  exclusion for it, let Renovate bump it. `pnpm install` in the builder stage
  now needs `pnpm-workspace.yaml` copied beside the lockfile.
- The three unused-until-UI1 groups (Storybook, Playwright, axe) are installed
  but unconfigured, so nothing runs them yet and the build is unchanged.
