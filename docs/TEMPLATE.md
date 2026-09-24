# Template conventions

Everything about this repository's structure, tooling, and workflow that's
identical across every instance of this template — as opposed to the root
`README.md`'s short, instance-owned preface. See `../CLAUDE.md`'s "Keeping
this file current" for where a new convention belongs.

`template-base` ships the generic "devcontainer + CI + AI-assisted
workflow" scaffold only — no application runtime, no backing services, no
language assumed. It carries no `src/`/`tests/` of its own. An instance
(a Python/Node.js/Rust/Go library, an infra-only repo, or a full
application) adds its own language runtime, backing services, and release
artifact on top of the shape described here.

## Contents

- `.devcontainer/` — the devcontainer setup; see its `README.md`. An
  instance that needs backing services adds a `stack/` directory here,
  following the "Devcontainer stack pattern" convention this template's
  own instances (e.g. `template-fastapi`) already establish.
- `.github/` — CI and release workflows; see its `CONTENTS.md`.
- `.vscode/` — editor settings, tasks; see its `README.md`.
- `.claude/` — Claude Code CLI project config; see its `README.md`.
- `.mcp.json` — project-scope MCP servers not covered by a
  `.claude/settings.json` plugin; see `.claude/README.md`.
- `docs/` — knowledge about what the instance does; this file is the one
  exception, documenting the template itself rather than product/domain
  knowledge. `adrs/`, `frs/`, `nfrs/`, `plans/` ship only their own
  `README.md` + `template.md` scaffolding — no numbered content, which is
  entirely instance-owned.
- `.secrets/` — local secret files, never committed; see its `README.md`.
- `Dockerfile` — a single `develop` stage (the devcontainer image). An
  instance adds its own `builder`/`runner` (or equivalent) stages on top
  for its own release artifact.
- `scripts/develop.sh`, `scripts/post-create.sh` — the `develop` stage's
  setup script and the devcontainer's `postCreateCommand`, each running
  an instance hook directory (`develop.d/`, `post-create.d/`); see
  `scripts/README.md` and "Instance extension points" below.
- `Makefile` — the release contract `release.yml` drives
  (`build`/`sbom`/`release-assets`/`publish`), each a documented no-op
  here — see "Release: a Makefile contract" below.
- `.pre-commit-config.yaml` — git hooks, run by `prek` or `pre-commit`;
  language-agnostic hooks only.
- `CLAUDE.md` — the AI-assisted coding workflow Claude Code follows in
  this repository; general conventions live in this file and each
  directory's own `README.md` instead.

## Instance extension points

Base-owned files stay `replace` tier (a sync overwrites them) and expose
hooks an instance fills with files it owns, so an instance never edits a
base-owned file directly. Don't edit `Dockerfile`, `scripts/develop.sh`
or `compose.yml` in an instance; use the hooks below.

| Hook | Base side (template-owned) | Instance side (instance-owned) |
|---|---|---|
| Extra devcontainer tooling | `Dockerfile` `develop` stage runs every `scripts/develop.d/*.sh` after `develop.sh` | `scripts/develop.d/NN-name.sh` |
| Extra post-create steps | `scripts/post-create.sh`, run by `devcontainer.json`'s `postCreateCommand`, runs every `scripts/post-create.d/*.sh` | `scripts/post-create.d/NN-name.sh` |
| Extra compose services / dev-service settings | `devcontainer.json` `"dockerComposeFile": ["compose.yml", "compose.instance.yml"]` | `.devcontainer/compose.instance.yml` (base ships a stub, `ignore` tier) |
| Runtime image | nothing (base `Dockerfile` is `develop`-only) | `app.Dockerfile` + `app.Dockerfile.dockerignore` |

Files with no include mechanism of their own (JSON configs,
`.pre-commit-config.yaml` — prek has no include) are `merge` tier, so an
instance's additions survive a sync. The runtime image goes in its own
`app.Dockerfile` so it never collides with the template-owned
`Dockerfile`; BuildKit picks up `app.Dockerfile.dockerignore`
automatically for `-f app.Dockerfile`.

## Getting started

1. Open this folder in a devcontainer (VS Code: "Reopen in Container" —
   `.vscode/extensions.json` recommends the extension that offers this —
   or any tool that reads `.devcontainer/devcontainer.json`). This builds
   the `develop` stage and installs the git hooks via `postCreateCommand`
   (`scripts/post-create.sh`).
2. There's nothing to run yet — `template-base` ships no application. An
   instance documents its own "run the app" / "run the CLI" step here.

Without a devcontainer: install [`prek`](https://prek.j178.dev/) and run
`prek install` once to enable the git hooks; install whatever else your
instance's own toolchain needs.

## Checks

`.pre-commit-config.yaml` defines whitespace/EOF fixers, YAML/TOML/JSON
checks, `conventional-pre-commit` (Conventional Commits, enforced at the
`commit-msg` stage), the `template-sync-manifest` completeness check, and
the `devcontainer-lock` lockfile-consistency check. An instance layers
its own language-specific hooks on top (lint,
format, type check, test suite, dependency-vulnerability scan, ...),
matching the shape `template-fastapi`'s own `.pre-commit-config.yaml`
already establishes for `ruff`/`mypy`/`pytest`/`pip-audit`.

Run everything at once with:

```bash
prek run --all-files --hook-stage manual
```

Every hook except the commit-message check carries the `manual` stage,
so the command above runs everything else regardless of which git hook
would normally trigger it. Commit messages can only be checked by
actually committing (see the comment in `.pre-commit-config.yaml`).

CI (`.github/workflows/checks.yml`) runs the same `--hook-stage manual`
command, inside the devcontainer itself, on every push and pull request
— as an `amd64`/`arm64` matrix, both legs native (no QEMU).
`.github/workflows/release.yml` is triggered manually to cut an
alpha/beta/rc/full release — see "Release: a Makefile contract" below and
`.github/workflows/README.md`.

## Release: a Makefile contract

`release.yml` computes the next SemVer tag (`compute_next_version.py`,
unchanged across every instance), then drives these targets:

| Target | Runs | Where | Env available |
|---|---|---|---|
| `release-arches` | once, first | host runner | none; must print a JSON array on stdout, e.g. `["amd64"]` |
| `build`, `sbom`, `release-assets`, `publish` | once **per arch**, in that order | host runner for that arch | `RELEASE_VERSION`, `RELEASE_TAG`, `RELEASE_ARCH`, `OCI_REGISTRY`, `OCI_IMAGE_NAME`, `OCI_REGISTRY_USERNAME`, `OCI_REGISTRY_PASSWORD`, all `GITHUB_*` |
| `release-check` | once, after all arches | **inside the devcontainer** (`devcontainers/ci`), stack up | `RELEASE_VERSION`, `RELEASE_TAG` |
| `finalize` | once, after `release-check` | host runner | same as per-arch minus `RELEASE_ARCH` |

What each target is for: `build` produces the release artifact(s) (an
image, `cargo build --release`, `npm pack`, `helm package`, ...); `sbom`
writes an SBOM for what `build` produced; `release-assets` populates
`dist/` (gitignored) with every file to attach to the GitHub release;
`publish` pushes to whatever registry applies, skipping cleanly when its
variable/secret isn't set; `release-check` runs checks that need the
backing services (e.g. tests producing a coverage report); `finalize`
does cross-arch work such as combining per-arch registry tags into one
multi-arch manifest list. `RELEASE_VERSION` (e.g. `1.2.3` or
`1.2.3-alpha.1`) and `RELEASE_TAG` (the same, `v`-prefixed) are for
embedding or tagging with the version. A single-arch no-op is the
default: `release-arches` prints `["amd64"]`.

`dist/` rules: each arch leg's `dist/` is uploaded as artifact
`release-assets-<arch>`, and the final job downloads all of them into one
`dist/`, so **per-arch file names must include the arch**. `release-check`
and `finalize` may add more files to `dist/`. `release.yml` then runs
`gh release create` with every file left in `dist/`.

The arch legs run natively, not under QEMU: `arm64` on `ubuntu-24.04-arm`,
`amd64` on `ubuntu-24.04`, each overridable with the `CI_RUNNER_ARM64` /
`CI_RUNNER_AMD64` repository/organization variables.

This repo's own `Makefile` implements every target as a documented
no-op, since `template-base` ships no artifact — it's both a working
example of the contract's shape and what `release.yml` needs to run
cleanly if this repo itself is ever released. An instance's `Makefile` is
not template-owned (it's the whole point that it differs per artifact
type), so it's tracked like any other instance-owned file — untouched by
this template's own sync manifest.

## Template sync

Once instantiated, a repo created from this template can pull in later
template fixes/improvements via `.github/workflows/template-sync.yml`
(itself template-owned, `replace`-tier): on a schedule (cadence set by
the `TEMPLATE_SYNC_INTERVAL` repository variable, `weekly` or `monthly`)
or on demand, it diffs the instance against the template's latest tagged
release, per `.github/template-sync-manifest.yml`'s three tiers
(`replace`, `ignore`, `merge` — see that file's header), and opens a PR
with the result. It never pushes directly or auto-merges; a genuine
`merge`-tier conflict is left with `<<<<<<<` markers for a human to
resolve. An instance that predates this workflow bootstraps its
`.github/template-sync-state.json` via the workflow's manual
`initial_sync_tag`/`template_repo` inputs first.

An instance that isn't itself a template shouldn't edit that manifest to
list its own files (`src/`, say): it's `merge`-tier, so edits would
conflict with later syncs. It lists them under an `ignore:` key in the
instance-owned
`.github/template-sync-manifest.local.yml` instead; the
`template-sync-manifest` check merges that file in, but sync never reads
it, and it accepts no other tier.

A repo can itself be both an instance of `template-base` *and* its own
template for further instances (e.g. `template-fastapi`): its own
`.github/template-sync-manifest.yml` classifies its *own* tracked files
for *its* downstream instances, entirely separate from this template's
manifest (it edits the manifest directly and resolves base's additions by
hand) — see that repo's own docs for the two-hop chain this produces.

## Versions and config

Every version and config value is defined in exactly one place; nothing
duplicates or re-pins it elsewhere. Everything pinned here (base image,
Actions, hook revisions, `prek`/Claude Code CLI/`snip`/`uv`/Python/
Node.js versions) is pinned once, at its single point of use, to an exact
patch version — never a floating range or `latest` — so Renovate can
bump them one at a time and the diff shows exactly what changed. An
instance's own language runtime/package versions follow the same rule in
its own Dockerfile/manifest.

`python3` and Node.js, both installed by `scripts/develop.sh` and pinned
via the Dockerfile's `PYTHON_VERSION`/`NODE_VERSION` ARGs, are
infrastructure tooling only — not an application runtime this template
assumes. `python3` exists because `prek` needs an interpreter to build
the venv for any `language: python` hook (`.pre-commit-config.yaml`'s
`pre-commit-hooks` repo) and because `.github/scripts/*.py` need one
directly; `uv` (its own `UV_VERSION` ARG) is only the mechanism used to
install that exact, checksum-verified CPython build rather than an
unpinned apt package, and stays on `PATH` afterward. Node.js exists
because `npx` (the `clear-thought` MCP server in `.mcp.json`) needs it.
An instance that adds Python or Node.js as its own application runtime
can reuse these directly rather than installing a second copy.

## Code style

Every file gets a brief header stating what the file *is for* — one
line, sometimes two: a leading comment for most formats, a module
docstring where the language has one. Never describe the file's contents
in the header; that's what reading the file is for. Markdown files' own
title/opening line already serves this purpose. A format with no comment
syntax (`.json`) documents itself via the directory's `README.md`
instead.

A comment earns its place by saying something the code/config next to it
can't: *why* it's written this way, a non-obvious consequence, or a
constraint that isn't visible locally. Don't add a comment that just
restates what the following line already says in code — if removing a
comment loses no information, remove it. Every existing comment in this
repository follows this rule; keep new ones held to the same bar.

## Do

- Read `CLAUDE.md` and the `README.md` of every directory on the path to
  whatever you're changing before you change it.
- Open this repo in the devcontainer rather than assembling the
  toolchain by hand — it's the one environment this template guarantees.

## Don't

- Commit a `.env` file, or read one from application code — configuration
  lives in the compose files; secrets live in `.secrets/`.
- Add a `ports:` mapping or a `networks:` block to any file under
  `.devcontainer/`.
- Assume a language runtime, backing service, or release artifact exists
  in this template — every one of those is instance-owned.
