#!/usr/bin/env bash
# Closes any still-open PR for a moderation branch and deletes the branch.
# Shared by moderate-cleanup.yml (issue closed) and the reset step in
# moderate-bug-triage.yml/moderate-feature-triage.yml (issue reopened) --
# see ../workflows/README.md's "Issue moderation" section for the state
# machine this supports. Idempotent: safe to call against a branch/PR
# that's already gone.
set -euo pipefail

branch="$1"
issue="$2"
reason="${3:-linked issue #$issue was closed}"

pr_json=$(gh pr list --state all --head "$branch" --json number,state --jq '.[0] // empty')
if [ -z "$pr_json" ]; then
  pr_json=$(gh pr list --state all --search "#$issue in:body" --json number,state,body \
    --jq "[.[] | select(.body | test(\"(?i)(fixes|closes) #$issue\\\\b\"))][0] // empty")
fi

if [ -n "$pr_json" ]; then
  pr_number=$(echo "$pr_json" | jq -r '.number')
  pr_state=$(echo "$pr_json" | jq -r '.state')
  if [ "$pr_state" = "OPEN" ]; then
    gh pr close "$pr_number" --comment "Closing: $reason."
  fi
fi

if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git push origin --delete "$branch"
fi
