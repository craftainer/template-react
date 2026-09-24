# CLAUDE.md

The AI-assisted coding workflow Claude Code follows in this repository.
Conventions about the repository or the app itself — not how an AI
assistant should work — live in the root `README.md` and each
directory's own `README.md` instead; see "Before writing anything" and
"Keeping this file current" below.

## Before writing anything

Read every `README.md` on the path from the repo root down to the
directory you're about to change, in order (e.g. before touching
`src/app/`, read the root `README.md`, then `src/README.md`, then
`src/app/README.md`). A directory's rules build on its parents'; a change
that's fine at the root can still violate a rule set closer to the file.

The one exception is `.github/`: its directory doc is named
`CONTENTS.md`, not `README.md`. GitHub renders `.github/README.md` as
the repository's homepage in place of the root `README.md` if one
exists there, which would bury the actual project overview — naming it
`CONTENTS.md` keeps the per-directory doc without triggering that.

## Keeping this file current

When a prompt establishes a new method or convention for this
repository, decide where it belongs before adding it anywhere:

- A convention about *how an AI assistant should approach work here*
  (workflow, verification habits, context/token handling) — not a
  one-off task — belongs in this file, so it keeps applying afterwards.
- A convention about the repository or app itself (how a directory is
  structured, how a service is configured, a coding rule) belongs in
  that directory's own `README.md` instead, so a human contributor sees
  it too without needing to open this file. Product/domain knowledge
  belongs in `docs/`, not either of these.

This file should stay small. If a section here starts describing what a
directory *contains* rather than how to work with Claude Code, that's a
sign it belongs in that directory's `README.md` instead.

Don't add a method or convention to this file (or a `README.md`) on your
own inference. If a prompt seems to establish one implicitly rather than
asking for it outright, tell the user what you think you detected and
ask whether to record it, rather than writing it unprompted.

## AI-assisted coding workflow

Practices below are distilled from Anthropic's own Claude Code guidance
(https://code.claude.com/docs/en/best-practices), applied to this repo:

- **Explore, then plan, then implement.** For anything touching more
  than one file, or where the approach isn't obvious, read the
  relevant code and the `README.md`s on the path to each file you'll
  touch (see "Before writing anything" above) and write a plan before
  editing.
  Skip planning for a change you could describe as a one-sentence diff.
  When asked to produce a plan, write it to `docs/plans/` per
  [`docs/plans/README.md`](docs/plans/README.md) rather than only
  answering inline — that file also covers what happens to the plan
  document once its work is executed (folded into an ADR/docs, or
  removed).
- **Report changes after executing.** After any turn that modified,
  created, or deleted files, close with a brief commit message for the
  user's use (a one-line summary plus a short bullet list of the most
  important changes) — don't create the commit yourself unless asked.
- **Verify before calling it done.** A change isn't finished until
  something has produced a pass/fail signal against it — `prek run
  --all-files --hook-stage manual`, or whatever lint/type-check/test/e2e
  commands the instance layers on top — and you've shown the actual
  output, not just asserted success. "Looks done" is not a verification
  step.
- **Address root causes.** Fix the underlying issue a failing check
  reports, not the check itself — don't silence a linter/type-checker
  finding with a broad suppression comment just to make output green;
  see `docs/TEMPLATE.md`'s "Checks" section for the narrow, justified
  exception.
- **Scope investigations.** When exploring the codebase to answer a
  question, read only what's needed to answer it, and prefer a
  subagent for anything that would otherwise pull many files into the
  main context.
- **Course-correct early.** If the same correction has to be made
  twice on one approach, stop and reconsider the approach itself
  rather than trying a third variation.
- **Resolve test coverage gaps in parallel.** When closing multiple
  test coverage gaps, first plan out which gaps are independent (touch
  disjoint files/modules with no shared state or ordering dependency),
  then dispatch one subagent per independent gap to write/fix its tests
  concurrently rather than working through the list serially. Gaps that
  share a file or depend on each other's changes stay sequential.
- **Flag devcontainer changes as needing a rebuild.** Editing anything
  under `.devcontainer/` (compose files, `stack/`, Dockerfiles) doesn't
  take effect in the running container — tell the user a rebuild is
  required and that only they can trigger it; don't claim the change is
  active or try to verify it live.
- **Use the devcontainer's own services, don't spin up your own.**
  Check `.devcontainer/compose.yml`'s `include:` and `.devcontainer/stack/`
  for which backing services (databases, object storage, auth, browsers,
  etc.) are already running before reaching for one yourself. Docker-in-
  Docker being available is not a signal to `docker run` a fresh instance
  of one of these for tests or debugging — connect to the existing
  service instead. If a needed service or version genuinely isn't
  provided, say so and ask, rather than standing up a parallel one.
- **Look up library/framework documentation with context7 first.**
  Before relying on training-data knowledge of a third-party library's
  or framework's API, use the context7 MCP tool to pull current
  documentation, rather than guessing or assuming an API shape from
  memory.
- **Use clear-thought for non-trivial reasoning when available.** When
  planning an approach, debugging, or working through a decision with
  more than one plausible path, use the clear-thought MCP tool if it's
  available, rather than reasoning through it unstructured.

`.claude/hooks/self-check.sh` automates the fast tier of this (see
`.claude/README.md`) but doesn't replace running the instance's own
slower checks (type checker, test suite, e2e suite, ...) yourself before
considering a change finished.

## Token efficiency

- **Read once, edit surgically.** Don't re-read a file already in
  context unless it changed since; prefer a targeted edit over a
  full-file rewrite.
- **No filler.** Skip restating the question and unsolicited closing
  summaries — state what changed and stop.
- **Clear, don't let it accumulate.** Between unrelated tasks, start a
  fresh session rather than carrying stale context forward; see
  "Compact instructions" below for what to keep when compacting instead.

## Compact instructions

When compacting, preserve which files have been edited and their
current state, the most recent check-suite output verbatim (pass or
fail, with any error text), and unresolved plan/TODO items. Summarize
away exploratory reads that didn't lead to a change.
