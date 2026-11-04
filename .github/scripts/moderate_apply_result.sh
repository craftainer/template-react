#!/usr/bin/env bash
# Applies one worker job's packaged result (a git patch + outcome
# metadata -- data, never executed as code) for the feature-build/bug-fix
# moderation pipelines: pushes the branch, opens (or reuses) the PR, and
# relabels the issue. This is the privileged half of the split described
# in ../workflows/README.md's "Issue moderation" section -- shared so the
# actual repo-write logic lives in one place. Runs as the `apply` job of
# moderate-bug-fix.yml / moderate-feature-build.yml.
set -euo pipefail

# shellcheck source=moderate_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/moderate_lib.sh"

# Needs, from the workflow's env: GH_TOKEN, GITHUB_REPOSITORY and
# DEFAULT_BRANCH (github.event.repository.default_branch).
: "${DEFAULT_BRANCH:?DEFAULT_BRANCH must be set}"

result_dir="$1"
branch_prefix="$2"    # "feature" or "bug"
branch_suffix="$3"    # "plan" or "repro"
ready_label="$4"      # e.g. "enhancement:plan-ready"
done_label="$5"       # e.g. "enhancement:built"
closes_verb="$6"      # "Closes" or "Fixes"

# Idempotent by design, so a maintainer's retry (re-adding the confirm
# label, which the workflow's gate job consumed when the run started) is
# always safe after a partial first run:
#   - the branch is pushed with --force-with-lease (a retry's `git am`
#     makes new SHAs);
#   - an open PR for the branch is reused, never duplicated;
#   - the stage label swaps in one `gh issue edit`, after the PR exists
#     (it also clears any needs-human an earlier failed attempt left).
# A failure leaves the stage at "ready" and flags needs-human.

# Failure path: needs-human first (the signal that matters), then a
# best-effort comment. The run link only appears when all of its parts exist.
fail() {
  gh issue edit "$issue_number" --add-label "needs-human" || true
  local run_url=""
  if [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
    run_url=" See $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID."
  fi
  gh issue comment "$issue_number" --body "$1$run_url Re-add the confirm label to retry once fixed." || true
  exit 1
}

meta="$result_dir/meta.json"
issue_number="$(jq -r '.issue_number' "$meta")"

if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
  echo "::error::issue_number in meta.json isn't numeric: $issue_number" >&2
  exit 1
fi
# The artifact must belong to the issue this run is for.
if [ -n "${ISSUE_NUMBER:-}" ] && [ "$issue_number" != "$ISSUE_NUMBER" ]; then
  echo "::error::issue_number in meta.json ($issue_number) is not this run's issue ($ISSUE_NUMBER)" >&2
  exit 1
fi

# Re-adding the confirm label during a run queues a second run behind the
# first (the workflow's concurrency group serializes them). If the ready
# label is already gone, a prior run already finished this issue: no-op.
if ! current_labels="$(gh issue view "$issue_number" --json labels --jq '.labels[].name')"; then
  fail "Reading the issue's labels failed."
fi
if ! grep -qxF "$ready_label" <<<"$current_labels"; then
  echo "Issue #$issue_number no longer carries $ready_label -- already processed, skipping."
  exit 0
fi

outcome="$(jq -r '.outcome' "$meta")"

# Everything that can fail on a "built" result. Explicit `|| return 1`, not
# errexit: the caller runs this in an `if !` condition, which suspends it.
# Nothing from meta.json reaches git or gh unvalidated: base_sha must be a full
# hex sha, the branch name is built from fixed parts plus a numeric issue
# number, and every ref follows a `--`.
apply_built() {
  local remote_sha pr_url
  is_sha "$base_sha" || { echo "::error::base_sha is not a 40-character sha" >&2; return 1; }
  if [ -f "$result_dir/patch.diff" ] && [ "$(wc -c < "$result_dir/patch.diff")" -gt "$MAX_PATCH_BYTES" ]; then
    echo "::error::patch.diff is over $MAX_PATCH_BYTES bytes" >&2
    return 1
  fi

  # The branch is bot-owned: triage's apply step creates `<prefix>/<n>-<suffix>`
  # (the repro/plan branch this result builds on) and only the apply scripts
  # write to it afterwards. The lease pins the tip read here, so a push by
  # anyone in between still fails. base_sha must be that tip or an ancestor of
  # it (an earlier attempt's commits sit on top); with no such branch it must
  # be an ancestor of the default branch. A tip that does not descend from
  # base_sha is foreign work: refuse.
  remote_sha="$(git ls-remote -- origin "refs/heads/$branch" | cut -f1)" || return 1
  if [ -n "$remote_sha" ]; then
    is_sha "$remote_sha" || return 1
    is_ancestor "$base_sha" "$remote_sha" || return 1
  else
    is_ancestor "$base_sha" "$DEFAULT_BRANCH" || return 1
  fi

  git config user.name "claude-moderator[bot]" || return 1
  git config user.email "claude-moderator[bot]@users.noreply.github.com" || return 1
  git fetch --depth=1 -- origin "$base_sha" || return 1
  git checkout -B "$branch" FETCH_HEAD -- || return 1
  git am -- "$result_dir/patch.diff" || return 1
  # The applied commits, not the patch text, are what gets checked: renames,
  # mode changes and binary files all show up in the diff.
  check_result_tree "$base_sha" || return 1
  git push --force-with-lease="$branch:$remote_sha" -- origin "$branch" || return 1

  pr_url="$(gh pr list --head "$branch" --state open --json number,url --jq '.[0].url // ""')" || return 1
  if [ -n "$pr_url" ]; then
    echo "Reusing open PR $pr_url for $branch."
  else
    gh pr create --title "$subject" --body "$body

$closes_verb #$issue_number" --base "$DEFAULT_BRANCH" --head "$branch" || return 1
  fi

  # Only now that the PR exists does the stage move on.
  gh issue edit "$issue_number" --remove-label "$ready_label" --remove-label "needs-human" --add-label "$done_label" || return 1
}

if [ "$outcome" = built ]; then
  base_sha="$(jq -r '.base_sha' "$meta")"
  branch="$branch_prefix/$issue_number-$branch_suffix"
  subject="$(jq -r --argjson n "$MAX_TITLE_CHARS" '(.subject // "") | .[0:$n]' "$meta")"
  body="$(jq -r --argjson n "$MAX_TEXT_CHARS" '(.body // "") | .[0:$n] | gsub("@"; "@\u200b")' "$meta")"

  if ! apply_built; then
    fail "Applying the automated result (patch, push, PR or relabel) failed."
  fi
else
  # Not built: the stage stays at "ready" on purpose, so a maintainer's
  # retry (re-adding the confirm label) re-runs the build.
  body="$(jq -r --argjson n "$MAX_TEXT_CHARS" '(.body // "") | .[0:$n] | gsub("@"; "@\u200b")' "$meta")"
  gh issue edit "$issue_number" --add-label "needs-human" || true
  gh issue comment "$issue_number" --body "$body"
fi
