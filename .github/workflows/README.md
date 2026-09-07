# workflows/

- `checks.yml` — runs every `prek`/`pre-commit` hook
  (`--hook-stage manual`, so both the fast and extensive ones) on push,
  on pull requests, and on demand — inside the actual devcontainer (via
  [`devcontainers/ci`](https://github.com/devcontainers/ci)), under a
  per-run `COMPOSE_PROJECT_NAME` that a final step tears down. Runs as a
  two-leg `amd64`/`arm64` matrix (see "Architecture matrix" below).
- `smoke.yml` — builds the `runner` stage of the root `Dockerfile` via
  the root `compose.yml`, starts it against the real Postgres, RustFS,
  Redis, and Keycloak backing services, and confirms `/health/live` and
  `/health/ready` both return 200 -- on push, on pull requests, and on
  demand. Runs as the same two-leg `amd64`/`arm64` matrix as
  `checks.yml` — this is the check that would actually catch an
  arch-specific runtime break (e.g. a C-extension dependency missing an
  arm64 wheel), since `checks.yml`'s `pytest` run uses `MODE=mock`
  in-process fakes for some paths rather than the built image.
- `release.yml` — manually triggered. Takes a release channel
  (`alpha`/`beta`/`rc`/`full`) and a SemVer 2 bump
  (`major`/`minor`/`patch`/`none`), computes the next tag via
  `../scripts/compute_next_version.py`, builds the `runner` stage of the
  root `Dockerfile` natively for both `amd64` and `arm64` (no QEMU —
  see "Architecture matrix" below), and creates a GitHub release with
  auto-generated notes and both images attached as arch-suffixed OCI
  tarballs (`template-fastapi-<version>-amd64.tar` /
  `-arm64.tar`), one SPDX-JSON SBOM per arch (via
  `anchore/sbom-action`/Syft), and a single `coverage.xml` report from
  running the test suite against the released commit. Each built image
  (both tarballs and, if configured, the registry push) carries
  standard `org.opencontainers.image.*` labels via
  `docker/metadata-action`, plus two custom
  `io.github.<repository_owner>.*` labels pointing at that arch's SBOM
  and the shared coverage-report release asset, so the image is
  self-describing. If an OCI registry is configured (see "OCI registry"
  below), each arch is pushed under its own `<version>-<arch>` tag and
  then combined into one real multi-arch manifest list at the plain
  `<version>` tag via `docker buildx imagetools create`, so `docker pull
template-fastapi:<version>` resolves to the right arch automatically.
- `moderate-bug-triage.yml` / `moderate-bug-fix.yml` /
  `moderate-feature-triage.yml` / `moderate-feature-build.yml` /
  `moderate-cleanup.yml` / `moderate-setup.yml` — see "Issue moderation"
  below.
- `template-sync.yml` — runs in an _instance_ of this template, not
  here (see the root `docs/TEMPLATE.md`'s "Template sync" section and
  `../template-sync-manifest.yml`'s header for the full design). On a
  schedule or `workflow_dispatch`, diffs the instance against the
  template's latest tagged release per the manifest's tiers and opens a
  PR — never a direct push, never auto-merged.

Every workflow's `runs-on` defaults to `ubuntu-24.04` but can be
overridden with the `CI_RUNNER` repository/organization variable —
e.g. to point at self-hosted runners.

## Architecture matrix

`checks.yml`, `smoke.yml`, and `release.yml`'s `build` job each run as a
two-leg matrix over `amd64`/`arm64`, both legs building/testing natively
— `ubuntu-24.04-arm` is a real (non-emulated) GitHub-hosted Linux arm64
runner, free on this public repo and billed as ordinary Actions minutes
on a private one. No QEMU is involved anywhere in this repo's CI; QEMU
would only be needed to cross-build one arch on a runner that doesn't
natively support it, which none of these jobs do.

Each matrix leg can be overridden independently with
`CI_RUNNER_AMD64` / `CI_RUNNER_ARM64` repository/organization variables
(each defaulting to the matching `ubuntu-24.04`/`ubuntu-24.04-arm`
label) — e.g. to point either arch at a self-hosted runner instead of
GitHub's. This is separate from the plain `CI_RUNNER` variable, which
still overrides the single-runner jobs (`perf.yml`, `template-sync.yml`,
and `release.yml`'s `version`/`manifest`/`release` jobs) that aren't
matrixed by arch.

The devcontainer used for local development (`Dockerfile`'s `develop`
stage) is deliberately _not_ pinned to a single platform — plain
`docker build`/`docker compose build` already targets whichever
architecture the host is on, so an arm64 contributor gets a native
arm64 devcontainer with no QEMU emulation in their inner loop. Only CI
needs to prove cross-arch correctness continuously; this was manually
verified end-to-end on arm64 hardware on 2026-09-06.

## Issue moderation

`moderate-bug-triage.yml`, `moderate-bug-fix.yml`,
`moderate-feature-triage.yml`, `moderate-feature-build.yml`, and
`moderate-cleanup.yml` run the `claude` CLI as an issue moderator: on a
bug report, it verifies the report is actionable, reproduces it as a
failing test on a branch, and asks the reporter to confirm before a
second workflow fixes it and opens a PR; on a feature request, it
verifies the request fits the project, drafts a plan on a branch, and
asks for confirmation before a second workflow implements it and opens a
PR.

Activating this in a given repo/fork takes two one-time steps, neither
of which is itself a workflow: provisioning a dedicated Anthropic
Console workspace (its own `ANTHROPIC_API_KEY`, a monthly spend limit,
and a usage alert at 80% of it) and storing that key as the
`ANTHROPIC_API_KEY` repository secret, then running `moderate-setup.yml`
once to create the labels below.

Two independent label sequences track state, applied by `gh issue edit`
inside each stage's Claude prompt (`../scripts/prompts/`) or by a
deterministic workflow step:

- Bug: `bug` → (`bug:needs-info` | `bug:repro-ready`) → `bug:confirmed`
  → `bug:fixed`.
- Feature: `enhancement` → (`enhancement:not-a-fit` |
  `enhancement:plan-ready`) → `enhancement:confirmed` →
  `enhancement:built`.

Either sequence can end at `needs-human` instead, if Claude can't
reproduce the bug / can't get the fix passing checks / can't complete
the feature per the plan — it comments what it tried and stops rather
than leaving the issue silently stuck. Run `moderate-setup.yml`
(`workflow_dispatch`) once, any time after adding the secret below, to
create these labels; it's idempotent, safe to re-run.

**Dormant until configured.** All four Claude-invoking workflows
(triage ×2, fix/build ×2) run a tiny upstream `gate` job that checks
`secrets.ANTHROPIC_API_KEY != ''` in a step and exposes it as a job
output — `secrets` isn't readable from `jobs.<job_id>.if` directly
(GitHub rejects the workflow as invalid if it is), only from a step or
`jobs.<job_id>.env`. The real job then carries
`if: needs.gate.outputs.has-key == 'true' && <trust condition>`,
checked before checkout — so a fork or clone that hasn't set the
`ANTHROPIC_API_KEY` repository secret sees every one of these jobs show
**Skipped**, not **Failed**, and gets no failure-triggered email from
GitHub's default Actions notifications. `moderate-cleanup.yml` has no
such gate (see its own header comment) and always runs.

**Trust gate.** The triage and fix/build jobs also skip unless
`github.event.issue.author_association` is `OWNER`, `MEMBER`, or
`COLLABORATOR`, or the issue carries a `claude:ok` label (a maintainer
opt-in for an external reporter) — the issue body and comments are
untrusted text fed straight into a Claude prompt, and this pipeline
pushes branches, spends API budget, and opens PRs from repo secrets.

**Reopening restarts triage from scratch.** Whatever stage label an
issue carried when closed, reopening it strips every `bug:*`/
`enhancement:*` stage label back to the bare `bug`/`enhancement` label
(`../scripts/reset_issue_state.sh`) and re-runs triage as if new, rather
than resuming stale state — the repo may have changed, or a prior
branch/PR may already be gone via cleanup.

**Environment.** All four Claude-invoking jobs run `claude` the same way
`checks.yml` runs `prek`: inside the actual devcontainer (`develop`
stage) via `devcontainers/ci`, so Claude runs the exact CLI build pinned
in `Dockerfile`'s `CLAUDE_CODE_VERSION`. Each writes the
`ANTHROPIC_API_KEY` secret to `.secrets/claude.txt` first (matching
`.secrets/README.md`'s "one file per secret" convention) and removes it
in an `if: always()` step; `../scripts/run_claude.sh` reads it, sets a
dedicated `claude-moderator[bot]` git identity for the commits this
pipeline makes, and invokes `claude -p <prompt> --model claude-sonnet-5
--effort medium --max-turns <n> --allowedTools <list>` under a
`timeout`. Every job caps wall-clock (`timeout-minutes:` 10 for triage,
20 for fix/build) and turns (15 for triage, 40 for fix/build) so a
runaway prompt fails closed instead of burning CI/API budget; the actual
spend cap lives in the Anthropic Console (a dedicated workspace/key with
a monthly limit), since `claude` itself has no such flag.

A single `moderate-issue-<number>` `concurrency:` group, shared across
all five moderation workflows, serializes every stage against the same
issue — a burst of comments can't launch overlapping fix/build jobs, a
close landing mid-run doesn't race cleanup, and a rapid close-then-reopen
runs cleanup before the reopened triage's reset step.

## Template sync

`template-sync.yml` reads its own operating parameters from repository
variables/secrets, all optional:

- `TEMPLATE_SYNC_INTERVAL` (variable, `weekly` | `monthly`, default
  `weekly`) — the workflow still wakes up weekly regardless (cron can't
  read a repository variable to pick its own schedule); on `monthly` it
  no-ops except during the first cron-scheduled week of the month.
- `TEMPLATE_SYNC_CHANNEL` (variable, `stable` | `alpha` | `beta` | `rc`,
  default `stable`) — which tag channel to sync to.
- `TEMPLATE_SYNC_TOKEN` (secret) — a PAT with read access to the
  template repository, if it's private. Falls back to the default
  `GITHUB_TOKEN` (works for a public template).

## OCI registry

`release.yml` only pushes to a registry when the `OCI_REGISTRY`
repository/organization variable is set (e.g. `ghcr.io`,
`docker.io`, or a private registry host) — the push step, the login
step, and the image-name step are all skipped otherwise, so the
workflow works with no registry configured at all. When it is set:

- `OCI_IMAGE_NAME` (variable, optional) — the image path within the
  registry, e.g. `myorg/template-fastapi`. Defaults to the repository's
  own `owner/repo` (lowercased) if unset.
- `OCI_REGISTRY_USERNAME` / `OCI_REGISTRY_PASSWORD` (secrets,
  required whenever `OCI_REGISTRY` is set) — credentials for
  `docker/login-action`.

## Image labels

Both copies of the published image (the OCI tarball and, if configured,
the registry push) carry the same label set, computed once by
`docker/metadata-action`:

- Standard `org.opencontainers.image.title` / `.description` / `.url` /
  `.source` / `.revision` (`github.sha`) / `.created` / `.version`,
  derived from git/GitHub context.
- `io.github.<repository_owner>.sbom` and
  `io.github.<repository_owner>.coverage-report` — URLs to that
  release's SBOM and `coverage.xml` assets. Namespaced under the repo
  owner (not `org.opencontainers.image.*`, which is reserved for the
  spec's own keys) and derived from `github.repository_owner` alone, so
  it's one stable prefix per org across every repo/template instance
  that org owns, rather than a per-repo namespace to look up each time.

## Do

- Give `release.yml` and `template-sync.yml` `contents: write` and
  nothing broader (`template-sync.yml` also needs `pull-requests:
write`, for nothing else); leave `checks.yml` at `contents: read`.

## Don't

- Add a third way to cut a release — extend `release.yml`'s inputs
  instead, so there's one path and one changelog source.
