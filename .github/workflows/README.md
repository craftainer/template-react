# workflows/

- `checks.yml` — runs every `prek`/`pre-commit` hook
  (`--hook-stage manual`, so both the fast and extensive ones) on push,
  on pull requests, and on demand — inside the actual devcontainer (via
  [`devcontainers/ci`](https://github.com/devcontainers/ci)), under a
  per-run `COMPOSE_PROJECT_NAME` that a final step tears down. Runs as a
  two-leg `amd64`/`arm64` matrix (see "Architecture matrix" below).
- `release.yml` — manually triggered. Takes a release channel
  (`alpha`/`beta`/`rc`/`full`) and a SemVer 2 bump
  (`major`/`minor`/`patch`/`none`), computes the next tag via
  `../scripts/compute_next_version.py`, then drives the instance's
  Makefile release contract (see `../../docs/TEMPLATE.md`'s "Release: a
  Makefile contract"): `make release-arches` picks the arch matrix;
  `build`/`sbom`/`release-assets`/`publish` run once per arch, natively
  (no QEMU — see "Architecture matrix" below), each leg uploading its
  `dist/` as `release-assets-<arch>`; the `release-check` job then assembles
  the `dist/`s (failing on a missing arch or a duplicate file name) and
  runs `make release-check` inside the devcontainer, gating the GitHub
  release and package publishing (not the per-arch image `publish`, which
  already ran in `build`); the `release` job runs `make finalize` and
  creates the GitHub release with everything in `dist/`; only then do
  `publish-packages` and
  `verify-published` run, and only for an instance that sets
  `PYPI_PUBLISH`, `NPM_PUBLISH` or `CARGO_PUBLISH`. A partial registry
  failure therefore never withholds the release.
- `visual.yml` — template-react only: builds Storybook and runs the
  Playwright screenshot and axe suite (`tests/visual/`) inside the pinned
  Playwright image on the `arm64` runner, uploading the HTML report on
  failure (see `docs/adrs/0005-storybook-visual-regression-and-axe.md`).
- `moderate-bug-triage.yml` / `moderate-bug-fix.yml` /
  `moderate-feature-triage.yml` / `moderate-feature-build.yml` /
  `moderate-cleanup.yml` / `moderate-setup.yml` — see "Issue moderation"
  below.
- `template-sync.yml` — runs in an *instance* of this template, not
  here (see the root `docs/TEMPLATE.md`'s "Template sync" section and
  `../template-sync-manifest.yml`'s header for the full design). On a
  schedule or `workflow_dispatch`, diffs the instance against the
  template's latest tagged release per the manifest's tiers and opens a
  PR — never a direct push, never auto-merged.
  `template_sync.py apply` exits 0 (clean), 1 (merge conflicts, still
  opens the PR) or 2 (error, e.g. an unreadable manifest or `git
  merge-file` failing): every failure other than conflicts exits 2. A
  binary merge-tier file the instance changed cannot be merged, so it is
  reported as a conflict and the instance's copy is left as it is. A crash before
  `apply`'s own handler (an import-time `SyntaxError`) also exits 1, so
  the job runs `template_sync.py check-apply`, which accepts a 0 or 1
  only when the summary `apply` wrote agrees with it; anything else
  fails the job before the sync state advances. The job then exits with
  `apply`'s own status when that is 2 or higher (so the log and the step's
  exit code tell an error from conflicts) and the summary is printed as valid
  only after that check.

Every workflow's `runs-on` defaults to `ubuntu-24.04` but can be
overridden with the `CI_RUNNER` repository/organization variable —
e.g. to point at self-hosted runners.

## Architecture matrix

`checks.yml` and `release.yml`'s `build` job each run as a
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
and `release.yml`'s `version`/`release-check`/`release`/`publish-packages`/`verify-published` jobs) that aren't
matrixed by arch.

The devcontainer used for local development (`.devcontainer/Dockerfile`'s `develop`
stage) is deliberately *not* pinned to a single platform — plain
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
failing test on a branch, and asks a maintainer to confirm (by adding
the `bug:confirm` label) before a second stage fixes it and opens a PR;
on a feature request, it verifies the request fits the project, drafts a
plan on a branch, and asks a maintainer to confirm (the
`enhancement:confirm` label) before a second stage implements it and
opens a PR.

**Fix/build is one workflow with two jobs, to keep Claude out of any job
that can push/PR/relabel.** `moderate-bug-fix.yml` /
`moderate-feature-build.yml` start on `issues: [labeled]` for the
`bug:confirm` / `enhancement:confirm` label. Only a user with triage
permission or above can add a label, so every run is initiated by a
privileged user; neither `issue_comment` (anyone who can see the issue
can comment) nor `workflow_run` is a trigger, which is what zizmor's
`dangerous-triggers` audit asks for. The `fix`/`build` job
(`permissions: contents: read` only) checks out the pinned branch tip
and runs Claude against the issue's untrusted title/body/comments, but
never holds write-scoped credentials. Claude commits locally (or, if it
can't converge, writes an explanation to `.moderation-outcome.md`) and
the job packages that as a `moderation-result` artifact
(`../scripts/moderate_package_result.sh`: a `git format-patch` diff plus a
small JSON outcome record — data, nothing executable). The `apply` job
(`needs:` the first one, its own job-level `permissions: contents:
write, issues: write, pull-requests: write`) runs from the default
branch's checkout, downloads that artifact and does the actual `git
am`/push/`gh pr create`/relabel (`../scripts/moderate_apply_result.sh`) —
the only things it executes are `git`/`gh` calls with literal, fixed
arguments (plus the patch's file contents, applied as a diff, never as a
command). It never runs Claude or code from the issue branch. This is
what a job combining Claude-on-untrusted-text with push/PR/label-write
credentials would otherwise trip on CodeQL's
`actions/untrusted-checkout`/`actions/untrusted-checkout-toctou`. The
`apply` job runs even when the first job failed (it uploads in an
`if: always()` step, so Claude's failure still becomes a "failed"
outcome comment) and is skipped when the first job was (no API key,
untrusted issue, stage label missing). If the artifact is missing
(the first job died before packaging), `apply` comments on the issue,
adds `needs-human` and fails; the message reads "no result artifact
(missing or download error)" and names the download step's outcome.

**The label is consumed at the start, and every apply step is
re-runnable.** The `gate` job (`issues: write` only) removes the confirm
label as the run starts, so a failed or skipped run never leaves it stuck
(`labeled` fires only when a label is added) and a maintainer retries by
adding it again. Re-adding it while a run is in flight queues the next run
under the concurrency group. `apply` is idempotent, so that retry is safe
after a partial first run:

- The branch (`<bug|feature>/<n>-<repro|plan>`) is bot-owned: triage's
  Claude run creates it and only `apply` writes to it afterwards. A
  retry's `git am` makes new SHAs, so `apply` pushes with
  `--force-with-lease=<branch>:<tip read from the remote>`: it fails if
  anyone pushed in between, and it refuses to overwrite a tip that is not
  the base SHA or a descendant of it (foreign work).
- An open PR for the branch (`gh pr list --head`) is reused, never
  duplicated.
- The stage label swaps in one `gh issue edit` (`*-ready` to
  `fixed`/`built`, also removing any `needs-human` an earlier failed
  attempt left) after the PR exists, inside the same failure handling. On any failure the stage stays
  `*-ready`; the issue gets `needs-human` first, then a best-effort
  comment (with the run link only when `GITHUB_SERVER_URL`,
  `GITHUB_REPOSITORY` and `GITHUB_RUN_ID` are all set), and the job fails.
- A non-built outcome (Claude could not converge) posts its note and adds
  `needs-human` but keeps `*-ready` on purpose: a maintainer's retry
  re-runs the build, which spends API budget again. If the label is
  re-added repeatedly during a run, each queued run can post its own
  not-built comment (the ready label is still present, so the re-check
  below does not skip them).
- The foreign-work check fetches with `--depth=100`. A remote tip more
  than 100 commits ahead of the base SHA is misjudged as foreign and
  fails with the generic "Applying the automated result failed" message.

**The confirm label means "run attempted".** `gate` consumes it even when
the run is then skipped (missing `ANTHROPIC_API_KEY`, untrusted author
without `claude:ok`, or no `*-ready` label), with no comment on the issue.
To see why nothing happened, open the run's `gate` job log and the skipped
`fix`/`build` job's condition.

The workflow shares the
per-issue concurrency group with the other moderation workflows when the
confirm label is what triggered it; any other label event gets a
throwaway group so it can't displace a queued confirm run. Known and
accepted: adding, removing and re-adding the confirm label in quick
succession can drop a queued run (GitHub keeps one pending run per group).
The apply script also re-checks the `*:*-ready` label before acting (a
no-op, not an error, if it's already gone).

**Confirmation is a maintainer's label, not the reporter's `/confirm`
comment.** Triage comments a link to the repro/plan and asks a
maintainer to add the confirm label once the reporter agrees. This
replaces the earlier `/confirm` comment from the issue author: a comment
trigger cannot tell who may start a spend-bearing run, a label can. The
maintainer who adds `bug:confirm` / `enhancement:confirm` is the
confirmer and should review the repro or plan branch first: the
`bug/<n>-repro` / `feature/<n>-plan` branch linked in triage's comment
on the issue (also under the repository's branches list). The run is
pinned to that branch's tip when the label is added, so it builds on
exactly what the maintainer saw only if they looked at the current tip.

Activating this in a given repo/fork takes two one-time steps, neither
of which is itself a workflow: provisioning a dedicated Anthropic
Console workspace (its own `ANTHROPIC_API_KEY`, a monthly spend limit,
and a usage alert at 80% of it) and storing that key as the
`ANTHROPIC_API_KEY` repository secret, then running `moderate-setup.yml`
once to create the labels below.

Two independent label sequences track state, applied by `gh issue edit`
inside each stage's Claude prompt (`../scripts/prompts/`) or by a
deterministic workflow step:

- Bug: `bug` → (`bug:needs-info` | `bug:repro-ready`) → `bug:fixed`; a maintainer adds `bug:confirm` to start the fix (the
  label is consumed when the run starts).
- Feature: `enhancement` → (`enhancement:not-a-fit` |
  `enhancement:plan-ready`) → `enhancement:built`; a maintainer adds
  `enhancement:confirm` to start the build (consumed when the run starts).

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
opt-in for an external reporter). Fix/build is additionally started only
by a triage+ user's confirm label, as above — the issue body and comments are
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
in `.devcontainer/Dockerfile`'s `CLAUDE_CODE_VERSION`. Each writes the
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

**Extra tools.** The read-only Claude jobs are limited to `git`, `gh`,
file tools and `prek run`. An instance that needs Claude to run more
(e.g. a targeted repro) sets the optional `MODERATION_EXTRA_TOOLS`
repository variable to extra comma-separated Claude Code `--allowedTools`
entries, e.g. `Bash(uv run pytest *)`; it's appended to each read-only
job's tool list and never applies to the `apply` jobs, which don't
run Claude.

A single `moderate-issue-<number>` `concurrency:` group, shared across
the two triage workflows, the two worker (fix/build) workflows, and
cleanup, serializes every stage against the same issue — a burst of
comments can't launch overlapping fix/build jobs, a close landing
mid-run doesn't race cleanup, and a rapid close-then-reopen runs cleanup
before the reopened triage's reset step. The two apply workflows sit
outside that group (see "Fix/build is itself split in two" above) — a
worker run's own membership in the group is what serializes it against
everything else, and by the time its artifact exists there's nothing
left for apply to race except a duplicate apply of the *same* artifact,
which the label re-check there already makes a no-op.

## Template sync

`template-sync.yml` reads its own operating parameters from repository
variables/secrets, all optional:

- `TEMPLATE_SYNC_INTERVAL` (variable, `weekly` | `monthly`, default
  `weekly`) — the workflow still wakes up weekly regardless (cron can't
  read a repository variable to pick its own schedule); on `monthly` it
  no-ops except during the first cron-scheduled week of the month.
- `TEMPLATE_SYNC_CHANNEL` (variable, `stable` | `alpha` | `beta` | `rc`,
  default `stable`) — which tag channel to sync to.
- `TEMPLATE_SYNC_TOKEN` (secret) — a PAT used to read the template
  repository and to push the sync branch / open the sync PR. It needs
  the `workflow` scope (classic PAT) or **Workflows: read/write**
  (fine-grained), because the default `GITHUB_TOKEN` can't push
  changes to `.github/workflows/`, and nearly every sync includes some.
  Falls back to `GITHUB_TOKEN`, which only works for a public template
  *and* a sync that touches no workflow file.

## OCI registry

`release.yml` only pushes to a registry when the `OCI_REGISTRY`
repository/organization variable is set (e.g. `ghcr.io`,
`docker.io`, or a private registry host) — the push step, the login
step, and the image-name step are all skipped otherwise, so the
workflow works with no registry configured at all. When it is set:

- `OCI_IMAGE_NAME` (variable, optional) — the image path within the
  registry, e.g. `myorg/template-fastapi`. Defaults to the repository's
  own `owner/repo` (lowercased) if unset.
- `OCI_REGISTRY_USERNAME` / `OCI_REGISTRY_PASSWORD` (secrets) —
  credentials for `docker/login-action`. Required whenever
  `OCI_REGISTRY` is set, except to push to the repository's own GHCR
  packages (`ghcr.io/<owner>/<repo>...`): the `build` and `release`
  jobs' `GITHUB_TOKEN` has `packages: write`, so the instance's
  `publish` and `finalize` can log in with `GITHUB_ACTOR`/`GITHUB_TOKEN` instead (see
  `../../docs/TEMPLATE.md`'s "Release: a Makefile contract"). The
  contract asks an instance's `publish` to prefer the secrets when they
  are set; they remain the way to reach any other registry.

## Image labels

The image is built once, with the label set computed by the Makefile's
`LABELS` (not by `docker/metadata-action`). The registry copy is that same
tar pushed with skopeo (`make publish`), not a rebuild, so the labels and
the digest are those of the tested artifact:

- `org.opencontainers.image.title` (the repository name), `.source` and
  `.url` (the repository), `.version` (`RELEASE_VERSION`), `.revision`
  (`git rev-parse HEAD`), `.created` (the commit time, not the build
  time), and `.licenses` (`OCI_LICENSE`,
  default `GPL-3.0-only`).
- `org.opencontainers.image.description`, only when the instance sets
  `OCI_DESCRIPTION` in `image.mk` (the Makefile has no offline source
  for the repository description).
- `io.github.<repository_owner>.sbom` — the URL of that release's SPDX
  SBOM asset. Namespaced under the repo owner (not
  `org.opencontainers.image.*`, which is reserved for the spec's own
  keys) and derived from the repository owner alone, so it's one stable
  prefix per org across every repo/template instance that org owns.
- `io.github.<repository_owner>.coverage-report`, only when the instance
  sets `COVERAGE_REPORT` in `image.mk` to the release asset's name.
- Whatever the instance adds through `EXTRA_LABELS`.

## Release variables and secrets

`release.yml` passes these to the Makefile targets as environment
variables of the same name; unset ones are empty, and a target should skip
cleanly when the registry isn't configured.

- `OCI_REGISTRY` (variable) — registry host (e.g. `ghcr.io`).
- `OCI_IMAGE_NAME` (variable, optional) — image path within the registry.
- `OCI_REGISTRY_USERNAME` / `OCI_REGISTRY_PASSWORD` (secrets) —
  registry credentials. Optional for the repository's own GHCR
  packages, which the `build` and `release` jobs' `GITHUB_TOKEN`
  (`packages: write`, actor `GITHUB_ACTOR`) can push to from `publish`
  and `finalize`.
- `CI_RUNNER_AMD64` / `CI_RUNNER_ARM64` (variables, optional) — runner
  labels for each arch leg, defaulting to `ubuntu-24.04` /
  `ubuntu-24.04-arm`.
- `PYPI_PUBLISH` (variable, optional) — `testpypi` or `pypi`; selects the
  index `make publish-packages` uploads to via trusted publishing. Unset
  skips it.
- `NPM_PUBLISH` / `CARGO_PUBLISH` (variables, optional) — non-empty makes
  `make publish-packages` push to npm / crates.io; unset skips it. Setting
  any of the three is what creates the `publish-packages` job at all.
  They are passed to that job and to `verify-published`, which is where
  an instance checks what was published (`release-check` runs before
  publishing and does not receive them).
- `NPM_TOKEN` / `CARGO_REGISTRY_TOKEN` (secrets, optional) — bootstrap
  tokens for the first release of a package, before trusted publishing
  is configured. Exposed only on the `make publish-packages` step's
  `env:` in the `publish-packages` job, never job-wide or to any other
  step or job. An unset secret arrives as an empty
  string, so the Makefile must treat empty as absent. `NPM_TOKEN` is
  deliberately not mapped to `NODE_AUTH_TOKEN`: npm's OIDC trusted
  publishing breaks when that variable is set, even to an empty string,
  so the npm template's Makefile decides what to do with `NPM_TOKEN`.

## Do

- Give `release.yml` and `template-sync.yml` `contents: write`, with
  exactly two additions and nothing else broader: `template-sync.yml`
  also needs `pull-requests: write`, and `release.yml`'s `build` and
  `release` jobs also have `packages: write`, so `make publish` and
  `make finalize` can push to the repository's own GHCR packages with
  `GITHUB_TOKEN` (no other job has it; the token is in `build`'s job
  env, so every per-arch target can use it). Leave `checks.yml` at `contents: read`.
- Keep `id-token: write` on `release.yml`'s `publish-packages` job only
  (PyPI, npm and crates.io trusted publishing via GitHub OIDC). GitHub
  permissions are per job, not per step, and that job's `if:` on the
  `*_PUBLISH` variables means an image-only instance never starts it, so
  it never requests an OIDC token. `build` (per arch) has no `id-token`.
- Keep `NPM_TOKEN` and `CARGO_REGISTRY_TOKEN` on the `make
  publish-packages` step's `env:` only.
- Pass `GITHUB_TOKEN` to a `devcontainers/ci` or `build-push-action` step
  that builds the devcontainer image (step `env:`, not the action's
  `env:` input), so `scripts/develop.sh`'s downloads are authenticated:
  `compose.yml` hands it to the build as the optional `github_token`
  secret, never a build arg.

## Don't

- Add a third way to cut a release — extend `release.yml`'s inputs
  instead, so there's one path and one changelog source.
