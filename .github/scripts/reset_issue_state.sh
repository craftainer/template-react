#!/usr/bin/env bash
# Strips stage labels back to the bare bug/enhancement label and reconciles
# any branch/PR left over from a prior run, so a reopened issue restarts
# triage from scratch instead of resuming stale state -- see
# ../workflows/README.md's "Issue moderation" section ("Reopening restarts
# triage from scratch"). Called from the reset step in
# moderate-bug-triage.yml/moderate-feature-triage.yml, "reopened" event only.
set -euo pipefail

kind="$1"       # bug | enhancement
issue="$2"

case "$kind" in
  bug)
    stage_labels=(bug:needs-info bug:repro-ready bug:confirmed bug:fixed needs-human)
    branch="bug/$issue-repro"
    ;;
  enhancement)
    stage_labels=(enhancement:not-a-fit enhancement:plan-ready enhancement:confirmed enhancement:built needs-human)
    branch="feature/$issue-plan"
    ;;
  *)
    echo "::error::unknown kind '$kind' (expected 'bug' or 'enhancement')" >&2
    exit 1
    ;;
esac

for label in "${stage_labels[@]}"; do
  gh issue edit "$issue" --remove-label "$label" 2>/dev/null || true
done

.github/scripts/moderate_cleanup.sh "$branch" "$issue" "issue #$issue was reopened, restarting triage"
