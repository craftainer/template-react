#!/usr/bin/env bash
# Packages a worker job's result -- a git patch plus outcome metadata,
# never anything executed -- for the matching privileged "apply"
# workflow to consume via a workflow_run artifact. See
# ../workflows/README.md's "Issue moderation" section: keeping
# push/PR/label-write capability out of this job (the one that runs
# Claude against untrusted issue text) is what closes CodeQL's
# actions/untrusted-checkout alert -- this job never holds a
# write-scoped GITHUB_TOKEN.
set -euo pipefail

base_sha="$1"
out_dir="$2"
outcome_marker="$3"

mkdir -p "$out_dir"

if [ -n "$(git log "${base_sha}..HEAD" --oneline)" ]; then
  outcome=built
  subject="$(git log -1 --format=%s HEAD)"
  body="$(git log -1 --format=%b HEAD)"
  git format-patch "${base_sha}..HEAD" --binary --stdout > "$out_dir/patch.diff"
elif [ -f "$outcome_marker" ]; then
  outcome=needs-human
  subject=""
  body="$(cat "$outcome_marker")"
else
  outcome=failed
  subject=""
  body="The automated run ended without a commit or an explanation (it may have crashed or hit its turn/time limit)."
fi

jq -n \
  --arg issue "$GITHUB_ISSUE_NUMBER" \
  --arg base_sha "$base_sha" \
  --arg outcome "$outcome" \
  --arg subject "$subject" \
  --arg body "$body" \
  '{issue_number: $issue, base_sha: $base_sha, outcome: $outcome, subject: $subject, body: $body}' \
  > "$out_dir/meta.json"
