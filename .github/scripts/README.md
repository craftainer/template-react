# scripts/

- `compute_next_version.py` — pure-stdlib script that reads existing git
  tags and prints the next `tag=` / `version=` / `prerelease=` for
  `../workflows/release.yml`, given a release channel and a SemVer 2
  bump.
- `template_sync_manifest.py` — parses `../template-sync-manifest.yml`
  and checks that every git-tracked path matches exactly one tier;
  backs both the `template-sync-manifest` prek hook and
  `../workflows/template-sync.yml`'s own use of the manifest. The check
  also merges in an instance's optional
  `../template-sync-manifest.local.yml` (`ignore` tier only).
- `check_devcontainer_lock.py` — checks that every remote feature in
  `../../.devcontainer/devcontainer.json` has a matching entry in
  `devcontainer-lock.json` and vice versa; backs the
  `devcontainer-lock` prek hook.
- `template_sync.py` — the diff/apply/state-file logic behind
  `../workflows/template-sync.yml`: picks the latest tag for a channel,
  applies the `replace`/`merge` tiers between two template checkouts and
  the instance working tree, and reads/writes
  `../template-sync-state.json`.
- `test_template_sync.py` — stdlib `unittest` tests for
  `template_sync.py`'s replace tier (including the executable bit and
  symlinked destinations), glob expansion of manifest entries, and a
  check that every script a workflow runs directly is executable; backs
  the `scripts-tests` prek hook.
- `assemble_dist.py` / `has_make_target.sh` — helpers of
  `../workflows/release.yml`: merge the per-arch `dist/` tarballs
  (validating ARCHES_JSON, rejecting any path two arches both produce,
  and extracting into a temp dir renamed over `dist/` only on success), and
  tell whether the Makefile defines a target without running it (the
  `verify-published` probe; the name is matched literally, and a target only
  listed in `.PHONY` counts as defined since `make` runs it as a no-op).
  `test_release_scripts.py` tests both; `scripts-tests` runs it. Keep
  `assemble_dist.py` clean under `ruff check --select ALL` (bar `COM812` and
  `CPY001`), so instances that select `PL` etc. need no per-file ignores.
- `run_claude.sh` — invokes `claude -p` for one issue-moderation stage
  inside the devcontainer; shared by all four Claude-invoking
  `../workflows/moderate-*.yml` jobs. See `../workflows/README.md`'s
  "Issue moderation" section.
- `moderate_cleanup.sh` — closes any open PR for a moderation branch and
  deletes the branch; used by `../workflows/moderate-cleanup.yml` (issue
  closed) and `reset_issue_state.sh` (issue reopened). Idempotent.
- `reset_issue_state.sh` — strips stage labels back to the bare
  `bug`/`enhancement` label and reconciles any leftover branch/PR, on
  issue reopen; used by `../workflows/moderate-bug-triage.yml` and
  `../workflows/moderate-feature-triage.yml`.
- `prompts/` — the Claude prompt for each moderation stage
  (`bug-triage.md`, `bug-fix.md`, `feature-triage.md`,
  `feature-build.md`), read by `run_claude.sh`.

## Do

- Keep scripts here dependency-free (stdlib only) — they run before
  `uv sync` in the release workflow.

## Don't

- Have a script here push a tag or create a release directly — that
  stays in the workflow YAML (via `gh`), so the workflow log shows the
  actual side effect.
