#!/usr/bin/env bash
# Applies one triage job's packaged result (outcome metadata and, for a repro
# or plan, a git patch -- data, never executed as code): pushes the repro/plan
# branch, comments on the issue and sets the stage label. The privileged half
# of the triage split described in ../workflows/README.md's "Issue moderation"
# section: the job that ran Claude on the untrusted issue text held a
# read-only token, so everything with write effect happens here, from the
# default branch's checkout, on values validated below.
#
# Usage: moderate_apply_triage.sh <bug|feature> <result_dir>
# Env: GH_TOKEN, GITHUB_REPOSITORY, DEFAULT_BRANCH, ISSUE_NUMBER (this run's
# issue); GITHUB_SERVER_URL/GITHUB_RUN_ID are optional (run link on failure).
set -euo pipefail

# shellcheck source=moderate_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/moderate_lib.sh"

: "${DEFAULT_BRANCH:?DEFAULT_BRANCH must be set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

kind="$1"
result_dir="$2"

# The action names Claude may report, and the label each one sets. The labels
# come from this table, never from the result.
case "$kind" in
  bug)
    prefix=bug suffix=repro
    declare -A label_for=([needs-info]="bug:needs-info" [repro-ready]="bug:repro-ready" [cannot-reproduce]="needs-human")
    branch_action=repro-ready
    only_prefix=
    ;;
  feature)
    prefix=feature suffix=plan
    declare -A label_for=([not-a-fit]="enhancement:not-a-fit" [plan-ready]="enhancement:plan-ready" [cannot-plan]="needs-human")
    branch_action=plan-ready
    only_prefix=docs/plans/
    ;;
  *)
    echo "::error::unknown kind '$kind' (expected 'bug' or 'feature')" >&2
    exit 1
    ;;
esac

meta="$result_dir/meta.json"

# Failure path: needs-human first (the signal that matters), then a
# best-effort comment. The run link only appears when all of its parts exist.
# Targets $issue_number, which is this run's issue (ISSUE_NUMBER) until the
# artifact's own number has been validated against it.
issue_number="${ISSUE_NUMBER:-}"
fail() {
  if [ -n "$issue_number" ]; then
    gh issue edit "$issue_number" --add-label "needs-human" || true
    local run_url=""
    if [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
      run_url=" See $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID."
    fi
    gh issue comment "$issue_number" --body "$1$run_url Reopen the issue to restart triage." || true
  fi
  exit 1
}

# The artifact is untrusted data: a missing or malformed meta.json, or one
# for another issue, is refused loudly. The fixed message never echoes it.
meta_issue="$(jq -r '.issue_number' "$meta")" || meta_issue=""
if ! [[ "$meta_issue" =~ ^[0-9]+$ ]]; then
  echo "::error::meta.json is missing, malformed, or its issue_number isn't numeric" >&2
  fail "Automated triage produced an unreadable result."
fi
if [ -n "$issue_number" ] && [ "$meta_issue" != "$issue_number" ]; then
  echo "::error::issue_number in meta.json ($meta_issue) is not this run's issue ($issue_number)" >&2
  fail "Automated triage produced a result for a different issue."
fi
issue_number="$meta_issue"
branch="$prefix/$issue_number-$suffix"

action="$(jq -r '(.action // "") | tostring' "$meta")"
# Claude's words are posted as text: capped, and `@` broken so it cannot ping.
comment="$(jq -r --argjson n "$MAX_TEXT_CHARS" '(.comment // "") | .[0:$n] | gsub("@"; "@​")' "$meta")"

if ! [[ "$action" =~ ^[a-z-]{1,30}$ ]] || [ -z "${label_for[$action]+set}" ] || [ -z "$comment" ]; then
  # Includes "failed" (no usable result), an action not in the table and an
  # empty comment: nothing from the result is acted on.
  # A "failed" result may carry the packaging step's own reason (a patch over
  # the size cap); any other unusable result is not echoed.
  note=""
  if [ "$action" = failed ] && [ -n "$comment" ]; then
    note=" $comment"
  fi
  gh issue edit "$issue_number" --add-label "needs-human" || true
  gh issue comment "$issue_number" --body "Automated triage ended without a usable result.$note A maintainer needs to look at this issue."
  exit 0
fi

# Everything that can fail on a repro/plan result. Explicit `|| return 1`, not
# errexit: the caller runs this in an `if !` condition, which suspends it.
apply_branch() {
  local base_sha remote_sha patch="$result_dir/patch.diff"
  base_sha="$(jq -r '.base_sha // ""' "$meta")"
  is_sha "$base_sha" || { echo "::error::base_sha is not a 40-character sha" >&2; return 1; }
  [ -f "$patch" ] || { echo "::error::a repro/plan result without a patch" >&2; return 1; }
  if [ "$(wc -c < "$patch")" -gt "$MAX_PATCH_BYTES" ]; then
    echo "::error::patch.diff is over $MAX_PATCH_BYTES bytes" >&2
    return 1
  fi
  # Triage builds on the default branch, so the base must be part of it.
  is_ancestor "$base_sha" "$DEFAULT_BRANCH" || return 1

  # A branch left by an earlier attempt of this same run is overwritten only
  # when it descends from the base; anything else is foreign work.
  remote_sha="$(git ls-remote -- origin "refs/heads/$branch" | cut -f1)" || return 1
  if [ -n "$remote_sha" ]; then
    is_sha "$remote_sha" || return 1
    is_ancestor "$base_sha" "$remote_sha" || return 1
  fi

  git config user.name "claude-moderator[bot]" || return 1
  git config user.email "claude-moderator[bot]@users.noreply.github.com" || return 1
  git fetch --depth=1 -- origin "$base_sha" || return 1
  git checkout -B "$branch" FETCH_HEAD -- || return 1
  git am -- "$patch" || return 1
  check_result_tree "$base_sha" "$only_prefix" || return 1
  git push --force-with-lease="$branch:$remote_sha" -- origin "$branch" || return 1
}

link=""
if [ "$action" = "$branch_action" ]; then
  if ! apply_branch; then
    fail "Applying the automated triage result (patch or push) failed."
  fi
  link="

Branch diff: ${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/compare/$DEFAULT_BRANCH...$branch"
fi

if ! gh issue comment "$issue_number" --body "$comment$link"; then
  fail "Posting the triage comment failed."
fi
if ! gh issue edit "$issue_number" --add-label "${label_for[$action]}"; then
  fail "Setting the triage label failed."
fi
