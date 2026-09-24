#!/usr/bin/env bash
# Applies one worker job's packaged result (a git patch + outcome
# metadata -- data, never executed as code) for the feature-build/bug-fix
# moderation pipelines: pushes the branch, opens the PR, and relabels the
# issue. This is the privileged half of the split described in
# ../workflows/README.md's "Issue moderation" section -- shared so the
# actual repo-write logic lives in one place.
set -euo pipefail

result_dir="$1"
branch_prefix="$2"    # "feature" or "bug"
branch_suffix="$3"    # "plan" or "repro"
ready_label="$4"      # e.g. "enhancement:plan-ready"
confirmed_label="$5"  # e.g. "enhancement:confirmed"
done_label="$6"       # e.g. "enhancement:built"
closes_verb="$7"      # "Closes" or "Fixes"

meta="$result_dir/meta.json"
issue_number="$(jq -r '.issue_number' "$meta")"

if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
  echo "::error::issue_number in meta.json isn't numeric: $issue_number" >&2
  exit 1
fi

# Idempotency: a second /confirm on the same issue can queue a second
# worker run behind the first (the worker's own concurrency group
# serializes those), but this apply workflow isn't concurrency-grouped
# against it (workflow_run can't see the issue number to key on before
# downloading the artifact) -- so if the ready label is already gone, a
# prior apply run already processed this issue. No-op rather than
# double-push/double-PR.
current_labels="$(gh issue view "$issue_number" --json labels --jq '.labels[].name')"
if ! grep -qxF "$ready_label" <<<"$current_labels"; then
  echo "Issue #$issue_number no longer carries $ready_label -- already processed, skipping."
  exit 0
fi

gh issue edit "$issue_number" --remove-label "$ready_label" --add-label "$confirmed_label"

outcome="$(jq -r '.outcome' "$meta")"

if [ "$outcome" = built ]; then
  base_sha="$(jq -r '.base_sha' "$meta")"
  branch="$branch_prefix/$issue_number-$branch_suffix"

  git config user.name "claude-moderator[bot]"
  git config user.email "claude-moderator[bot]@users.noreply.github.com"
  git fetch --depth=1 origin "$base_sha"
  git checkout -B "$branch" FETCH_HEAD
  git am "$result_dir/patch.diff"
  git push -u origin "$branch"

  subject="$(jq -r '.subject' "$meta")"
  body="$(jq -r '.body' "$meta")"
  gh pr create --title "$subject" --body "$body

$closes_verb #$issue_number" --base main --head "$branch"

  gh issue edit "$issue_number" --remove-label "$confirmed_label" --add-label "$done_label"
else
  body="$(jq -r '.body' "$meta")"
  gh issue comment "$issue_number" --body "$body"
  gh issue edit "$issue_number" --add-label "needs-human"
fi
