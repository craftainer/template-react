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
  `../template-sync-state.json`. Its `check-apply` subcommand cross-checks
  `apply`'s exit status against the summary it wrote, so a crash that
  exits 1 is not read as merge conflicts. A merge-tier file the instance
  never changed takes the new version outright (content and executable bit,
  keeping its other mode bits); a merged file keeps its own mode. A binary
  one the instance did change is reported as a conflict and left as it is;
  since it has no conflict markers, it is also listed in the summary's
  `merge.binary`, labelled in the PR body and annotated with `::warning::` in
  the job log. The workflow's apply step writes only `check-apply`'s validated
  `conflicts=0|1` line to `$GITHUB_OUTPUT`. `apply` catches its broad failure with
  `logging.exception` rather than a `noqa`, so instances that don't
  select ruff's `BLE` rules see no unused-`noqa` finding.
  `apply` is not atomic: on exit 2, files written before the error stay on
  disk. CI is safe because the runner checkout is discarded and the sync
  state does not advance. After a failed manual run, reset the working tree
  with `git checkout -- .` and then `git clean -fd` (separate commands).
- `test_template_sync.py` — stdlib `unittest` tests for
  `template_sync.py`'s replace and merge tiers (including the executable
  bit, re-running a merge, symlinked destinations, and `git merge-file`
  errors raising instead of counting as conflicts, binary files counting
  as conflicts, symlinked destinations kept on removal, one tree walk for
  all globs, `apply`'s exit codes: 0 clean, 1 conflicts, 2 error,
  including a missing or undecodable manifest and a failing `tier_paths`,
  and `check-apply`), glob expansion of
  manifest entries, and a check that every script a workflow runs directly
  is executable; backs the `scripts-tests` prek hook.
- `assemble_dist.py` / `has_make_target.sh` — helpers of
  `../workflows/release.yml`: merge the per-arch `dist/` tarballs
  (validating ARCHES_JSON, rejecting any path two arches both produce,
  and extracting into a temp dir renamed over `dist/` only on success), and
  tell whether the Makefile defines a target without running it (the
  `verify-published` probe; the name is matched literally, and a target only
  listed in `.PHONY` counts as defined since `make` runs it as a no-op).
  `assemble_dist.py` reads each tarball once and sets the staged `dist/`'s
  mode to 0755 after extracting (`mkdtemp` creates it 0700), so the build's
  `.` member cannot matter: the `data` extraction filter sets a directory's
  mode to `None`, so no member restricts the staging directory mid-run (a test
  pins this). A failed run, including a collision found in a later leg,
  discards the staging directory and leaves `dist/` untouched. A corrupt or
  truncated tarball (including a cut-off compressed one) is an `::error::`
  naming the file, not a traceback.
  `has_make_target.sh` runs no recipe, but make still evaluates
  `$(shell ...)` and `include` while parsing the Makefile.
  `test_release_scripts.py` tests both, `verify_release_tag.sh`, and that
  `../../scripts/develop.sh` never nests `fetch` inside `retry`;
  `scripts-tests` runs it. Keep
  `assemble_dist.py` clean under `ruff check --select ALL` (bar `COM812` and
  `CPY001`), so instances that select `PL` etc. need no per-file ignores.
  `template_sync.py` and its test keep to a 100-column line length and name
  their magic numbers (`MAX_CONFLICTS`, `FIRST_WEEK_LAST_DAY`), so instances
  running ruff's `E501` and `PLR2004` need no ignores for them either.
- `ruff.toml` / `test_script_syntax.py` — the workflows run these scripts
  with the runner's system `python3` (3.12 on ubuntu-24.04, no
  setup-python), but an instance's ruff takes `target-version` from its own
  `pyproject.toml` (py314 in the Python templates) and would rewrite
  `except (A, B):` to the 3.14-only PEP 758 form, a SyntaxError in CI.
  Ruff uses the closest config file and does not merge parents, so
  `ruff.toml` (replace tier, via this directory's manifest entry) pins
  `target-version = "py312"`, the 100-column line length and ruff's default
  lint rules for every file here, whatever the instance configures; this
  supersedes the instance-level `select ALL` remarks above for these files.
  `test_script_syntax.py` parses every script with
  `ast.parse(feature_version=(3, 12))` and checks `ruff.toml` names the same
  version. The runner image's `python3` is not read at test time (that would
  need the network), so `test_script_syntax.py` also maps each runner label
  the workflows default to (`ubuntu-24.04`) to its Python: when Renovate bumps
  that label the test fails until you look up the new image's `python3`
  (actions/runner-images) and update `RUNNER_IMAGE_PYTHON`, `RUNNER_PYTHON` and
  `ruff.toml` together.
- `verify_release_tag.sh` — the `release` job's check that an already
  published release's tag points at the commit the run built (fails closed;
  retries only transient lookup errors, six attempts over about two
  minutes, and never a missing tag or a missing token, which it recognises by
  `gh`'s own "set/populate the GH_TOKEN environment variable" message, not
  by any stderr that names `GH_TOKEN`). `TAG_LOOKUP_ATTEMPTS` (1-99) and `TAG_LOOKUP_DELAY` (0-9999, no leading zeros) are validated up
  front, every attempt's stderr is logged labelled with its attempt number,
  and a 404 is not retried even on a just-created tag: GitHub documents no
  read-after-write lag for refs, so the error says to re-run once the tag is
  visible. Tested against a fake `gh` in
  `test_release_scripts.py`.
- `find_moderation_result.sh` / `test_moderation_scripts.py` — the check
  step shared by `../workflows/moderate-bug-fix-apply.yml` and
  `../workflows/moderate-feature-build-apply.yml`: asks the API for the
  `moderation-result` artifact by name (so it is found however many
  artifacts the run has) and writes `found=true|false`. It fails on an
  expired artifact (a produced result that can no longer be applied; the
  message says to re-run the worker run, since re-running the apply run
  cannot bring the artifact back), an
  API error, and an empty or unrecognised response. The tests run it
  against a fake `gh`.
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
