# scripts/

- `compute_next_version.py` — pure-stdlib script that reads existing git
  tags and prints the next `tag=` / `version=` / `prerelease=` for
  `../workflows/release.yml`, given a release channel and a SemVer 2
  bump.
- `template_sync_manifest.py` — parses `../template-sync-manifest.yml`
  and checks that every git-tracked path matches exactly one tier;
  backs both the `template-sync-manifest` prek hook and
  `../workflows/template-sync.yml`'s own use of the manifest.
- `template_sync.py` — the diff/apply/state-file logic behind
  `../workflows/template-sync.yml`: picks the latest tag for a channel,
  applies the `replace`/`merge` tiers between two template checkouts and
  the instance working tree, and reads/writes
  `../template-sync-state.json`.
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
- Add a test in `../../tests/` for any new logic here that isn't trivial.

## Don't

- Have a script here push a tag or create a release directly — that
  stays in the workflow YAML (via `gh`), so the workflow log shows the
  actual side effect.
